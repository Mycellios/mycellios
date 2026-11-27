// Windows Job Object broker (contract: src/distribution/windows-job-broker.ts,
// physical behaviour: tests/windows-job-broker-physical.test.ts).
//
//   mycellios-job-broker --probe          prints the ready marker and exits 0
//   mycellios-job-broker <request.json>   runs one target inside a kill-on-close Job
//
// The request is read once and deleted. It must name the broker's real parent
// process, the target is created suspended and only resumed once it belongs to
// the Job, and the Job is terminated when either the broker or its trusted
// parent goes away, so no target or descendant can outlive its owner.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Mycellios.JobBroker;

internal static unsafe class Program
{
    private const string Schema = "mycellios-windows-job-broker/1";
    private const string ProbeMarker = "mycellios-windows-job-broker/1:ready";
    private const int RejectedExitCode = 70;
    private const int MaximumArguments = 512;
    private const int MaximumArgumentLength = 32_000;
    private const int MaximumRequestBytes = 1024 * 1024;

    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--probe")
        {
            Console.Out.Write(ProbeMarker + "\n");
            Console.Out.Flush();
            return 0;
        }
        if (args.Length != 1)
        {
            return Reject("broker_usage_is_invalid");
        }
        try
        {
            return Run(args[0]);
        }
        catch (BrokerRejection rejection)
        {
            return Reject(rejection.Code);
        }
        catch (Win32Exception error)
        {
            return Reject($"broker_native_call_failed:{error.NativeErrorCode}");
        }
    }

    private static int Run(string requestPath)
    {
        var request = ReadAndDeleteRequest(requestPath);
        var actualParent = ParentProcessId();
        if (actualParent != request.ParentPid)
        {
            throw new BrokerRejection("trusted_parent_pid_does_not_match_broker_parent");
        }
        // Hold the parent open before starting work so its exit is observed even
        // if the PID is reused later.
        var parent = Native.OpenProcess(Native.Synchronize | Native.ProcessQueryLimitedInformation, false, (uint)request.ParentPid);
        if (parent == IntPtr.Zero)
        {
            throw new BrokerRejection("trusted_parent_is_unavailable");
        }
        if (ParentProcessId() != request.ParentPid)
        {
            throw new BrokerRejection("trusted_parent_pid_does_not_match_broker_parent");
        }

        var job = Native.CreateJobObjectW(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits = new Native.JobObjectExtendedLimitInformation();
        limits.BasicLimitInformation.LimitFlags = Native.JobObjectLimitKillOnJobClose | Native.JobObjectLimitDieOnUnhandledException;
        if (!Native.SetInformationJobObject(job, Native.JobObjectExtendedLimitInformationClass, &limits, (uint)sizeof(Native.JobObjectExtendedLimitInformation)))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        var startup = new Native.StartupInfo
        {
            Cb = (uint)sizeof(Native.StartupInfo),
            Flags = Native.StartfUseStdHandles,
            StdInput = Native.GetStdHandle(Native.StdInputHandle),
            StdOutput = Native.GetStdHandle(Native.StdOutputHandle),
            StdError = Native.GetStdHandle(Native.StdErrorHandle),
        };
        var commandLine = BuildCommandLine(request.Executable, request.Args);
        Native.ProcessInformation process;
        fixed (char* executable = request.Executable)
        fixed (char* cwd = request.Cwd)
        fixed (char* line = commandLine)
        {
            if (!Native.CreateProcessW(executable, line, IntPtr.Zero, IntPtr.Zero, true,
                    Native.CreateSuspended | Native.CreateNoWindow | Native.CreateUnicodeEnvironment,
                    IntPtr.Zero, cwd, &startup, &process))
            {
                throw new BrokerRejection($"target_start_failed:{Marshal.GetLastWin32Error()}");
            }
        }
        if (!Native.AssignProcessToJobObject(job, process.Process))
        {
            var error = Marshal.GetLastWin32Error();
            Native.TerminateProcess(process.Process, RejectedExitCode);
            throw new BrokerRejection($"target_job_assignment_failed:{error}");
        }
        if (Native.ResumeThread(process.Thread) == uint.MaxValue)
        {
            var error = Marshal.GetLastWin32Error();
            Native.TerminateJobObject(job, RejectedExitCode);
            throw new BrokerRejection($"target_resume_failed:{error}");
        }
        Native.CloseHandle(process.Thread);

        var handles = stackalloc IntPtr[2];
        handles[0] = process.Process;
        handles[1] = parent;
        var signalled = Native.WaitForMultipleObjects(2, handles, false, Native.Infinite);
        if (signalled != Native.WaitObject0)
        {
            // The trusted parent exited (or the wait failed): stop the whole tree.
            Native.TerminateJobObject(job, 1);
            return 1;
        }
        if (!Native.GetExitCodeProcess(process.Process, out var exitCode))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        // Returning closes the Job handle; kill-on-close stops leftover descendants.
        return unchecked((int)exitCode);
    }

    private static BrokerRequest ReadAndDeleteRequest(string requestPath)
    {
        if (!Path.IsPathFullyQualified(requestPath))
        {
            throw new BrokerRejection("request_path_must_be_absolute");
        }
        byte[] bytes;
        try
        {
            var info = new FileInfo(requestPath);
            if (!info.Exists || info.Length > MaximumRequestBytes || (info.Attributes & FileAttributes.ReparsePoint) != 0)
            {
                throw new BrokerRejection("request_file_is_invalid");
            }
            bytes = File.ReadAllBytes(requestPath);
        }
        catch (IOException) { throw new BrokerRejection("request_file_is_unreadable"); }
        catch (UnauthorizedAccessException) { throw new BrokerRejection("request_file_is_unreadable"); }
        finally
        {
            try { File.Delete(requestPath); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
        try
        {
            using var document = JsonDocument.Parse(bytes);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw new BrokerRejection("request_is_invalid");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in root.EnumerateObject())
            {
                if (!seen.Add(property.Name) || property.Name is not ("schema" or "executable" or "args" or "cwd" or "parentPid"))
                {
                    throw new BrokerRejection("request_is_invalid");
                }
            }
            if (seen.Count != 5 || root.GetProperty("schema").ValueKind != JsonValueKind.String
                || root.GetProperty("schema").GetString() != Schema)
            {
                throw new BrokerRejection("request_schema_is_invalid");
            }
            var executable = AbsolutePath(root.GetProperty("executable"), "request_executable_is_invalid");
            if (!File.Exists(executable)) throw new BrokerRejection("request_executable_is_missing");
            var cwd = AbsolutePath(root.GetProperty("cwd"), "request_cwd_is_invalid");
            if (!Directory.Exists(cwd)) throw new BrokerRejection("request_cwd_is_missing");
            var argsElement = root.GetProperty("args");
            if (argsElement.ValueKind != JsonValueKind.Array || argsElement.GetArrayLength() > MaximumArguments)
            {
                throw new BrokerRejection("request_args_are_invalid");
            }
            var arguments = new List<string>();
            foreach (var argument in argsElement.EnumerateArray())
            {
                var value = argument.ValueKind == JsonValueKind.String ? argument.GetString() : null;
                if (value is null || value.Length > MaximumArgumentLength || value.Contains('\0'))
                {
                    throw new BrokerRejection("request_args_are_invalid");
                }
                arguments.Add(value);
            }
            var parentElement = root.GetProperty("parentPid");
            if (parentElement.ValueKind != JsonValueKind.Number || !parentElement.TryGetInt32(out var parentPid) || parentPid < 1)
            {
                throw new BrokerRejection("request_parent_pid_is_invalid");
            }
            return new BrokerRequest(executable, arguments, cwd, parentPid);
        }
        catch (JsonException) { throw new BrokerRejection("request_is_invalid"); }
        catch (KeyNotFoundException) { throw new BrokerRejection("request_is_invalid"); }
    }

    private static string AbsolutePath(JsonElement element, string code)
    {
        var value = element.ValueKind == JsonValueKind.String ? element.GetString() : null;
        if (value is null || value.Length == 0 || value.Length > 32_000 || value != value.Trim()
            || value.IndexOfAny(new[] { '\0', '\r', '\n', '"' }) >= 0 || !Path.IsPathFullyQualified(value))
        {
            throw new BrokerRejection(code);
        }
        return Path.GetFullPath(value);
    }

    /// <summary>Quotes argv so CommandLineToArgvW and the C runtime read it back exactly.</summary>
    internal static string BuildCommandLine(string executable, IReadOnlyList<string> arguments)
    {
        var builder = new StringBuilder();
        builder.Append('"').Append(executable).Append('"');
        foreach (var argument in arguments)
        {
            builder.Append(' ');
            AppendQuoted(builder, argument);
        }
        return builder.ToString();
    }

    private static void AppendQuoted(StringBuilder builder, string argument)
    {
        if (argument.Length > 0 && argument.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
        {
            builder.Append(argument);
            return;
        }
        builder.Append('"');
        var backslashes = 0;
        foreach (var character in argument)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }
            if (character == '"')
            {
                builder.Append('\\', backslashes * 2 + 1).Append('"');
            }
            else
            {
                builder.Append('\\', backslashes).Append(character);
            }
            backslashes = 0;
        }
        builder.Append('\\', backslashes * 2).Append('"');
    }

    private static int ParentProcessId()
    {
        var information = new Native.ProcessBasicInformation();
        var status = Native.NtQueryInformationProcess(Native.GetCurrentProcess(), 0, &information,
            (uint)sizeof(Native.ProcessBasicInformation), out _);
        if (status != 0) throw new BrokerRejection($"broker_parent_lookup_failed:{status}");
        return unchecked((int)(long)information.InheritedFromUniqueProcessId);
    }

    private static int Reject(string code)
    {
        Console.Error.Write(code + "\n");
        Console.Error.Flush();
        return RejectedExitCode;
    }

    private sealed record BrokerRequest(string Executable, IReadOnlyList<string> Args, string Cwd, int ParentPid);

    private sealed class BrokerRejection(string code) : Exception(code)
    {
        public string Code { get; } = code;
    }
}

internal static unsafe class Native
{
    public const uint Synchronize = 0x0010_0000;
    public const uint ProcessQueryLimitedInformation = 0x1000;
    public const uint CreateSuspended = 0x0000_0004;
    public const uint CreateUnicodeEnvironment = 0x0000_0400;
    public const uint CreateNoWindow = 0x0800_0000;
    public const uint StartfUseStdHandles = 0x0000_0100;
    public const int StdInputHandle = -10;
    public const int StdOutputHandle = -11;
    public const int StdErrorHandle = -12;
    public const uint JobObjectLimitKillOnJobClose = 0x0000_2000;
    public const uint JobObjectLimitDieOnUnhandledException = 0x0000_0400;
    public const int JobObjectExtendedLimitInformationClass = 9;
    public const uint Infinite = 0xFFFF_FFFF;
    public const uint WaitObject0 = 0;

    [StructLayout(LayoutKind.Sequential)]
    public struct StartupInfo
    {
        public uint Cb;
        public IntPtr Reserved;
        public IntPtr Desktop;
        public IntPtr Title;
        public uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        public ushort ShowWindow, Reserved2;
        public IntPtr Reserved2Pointer;
        public IntPtr StdInput, StdOutput, StdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ProcessInformation
    {
        public IntPtr Process, Thread;
        public uint ProcessId, ThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IoCounters
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ProcessBasicInformation
    {
        public IntPtr ExitStatus, PebBaseAddress, AffinityMask, BasePriority, UniqueProcessId, InheritedFromUniqueProcessId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr CreateJobObjectW(IntPtr attributes, char* name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetInformationJobObject(IntPtr job, int informationClass, void* information, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CreateProcessW(char* application, char* commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint creationFlags,
        IntPtr environment, char* currentDirectory, StartupInfo* startupInfo, ProcessInformation* processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForMultipleObjects(uint count, IntPtr* handles, [MarshalAs(UnmanagedType.Bool)] bool waitAll, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll")]
    public static extern IntPtr GetStdHandle(int handle);

    [DllImport("kernel32.dll")]
    public static extern IntPtr GetCurrentProcess();

    [DllImport("ntdll.dll")]
    public static extern int NtQueryInformationProcess(IntPtr process, int informationClass, void* information,
        uint length, out uint returnLength);
}
