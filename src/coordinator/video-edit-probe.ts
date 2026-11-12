import {execFile} from "node:child_process";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

/** Fixed executable/arguments; clips never become shell commands or remote URLs. */
export async function probeManagedEdit(bytes:Buffer) {
 if(bytes.length<12 || bytes.length>64*1024*1024 || bytes.toString("ascii",4,8)!=="ftyp")throw new Error("video_edit_mp4_invalid");
 const dir=await mkdtemp(join(tmpdir(),"mycellios-edit-probe-"));
 try {
  const file=join(dir,"clip.mp4");await writeFile(file,bytes,{mode:0o600});
  const text=await new Promise<string>((resolve,reject)=>execFile(process.env.MYCELLIOS_FFPROBE_PATH||"ffprobe",
   ["-v","error","-show_entries","format=duration:stream=codec_type,codec_name,width,height","-of","json",file],
   {timeout:20000,maxBuffer:100000,windowsHide:true},(error,stdout)=>error?reject(new Error("video_edit_probe_failed")):resolve(stdout)));
  const value=JSON.parse(text),v=value.streams?.find((s:any)=>s.codec_type==="video"),duration=Number(value.format?.duration);
  if(!v || v.codec_name!=="h264" || !Number.isFinite(duration)||duration<1||duration>30 || !Number.isInteger(v.width)||!Number.isInteger(v.height)
   || v.width<128||v.height<128||v.width>3840||v.height>3840)throw new Error("video_edit_mp4_invalid");
  return {duration,width:v.width as number,height:v.height as number};
 } finally {await rm(dir,{recursive:true,force:true});}
}
