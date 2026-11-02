import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

/** Only the isolated staging copy may have its older Torch namespace removed. */
export async function removeCopiedDirectmlTorch(staging: string): Promise<void> {
  const site = join(staging, "Lib", "site-packages");
  for (const name of await readdir(site)) {
    if (["torch", "torchgen", "functorch"].includes(name) || /^torch-[\w.+]+\.dist-info$/.test(name)) {
      await rm(join(site, name), { recursive: true, force: true });
    }
  }
}

const artifact = (label: string, url: string, sha256: string, sizeBytes: number) => ({ label, url: `${url}#sha256=${sha256}`, sha256, sizeBytes });

export const WINDOWS_DIRECTML_PACK = {
  id: "win-x64-py312-torch241-directml025-v2", backend: "directml",
  platform: "win32", arch: "x64", strategy: "pinned-download",
  launchDevice: "directml", torchVersion: "2.4.1+cpu",
  minimumFreeBytes: 3 * 1024 ** 3,
  installGroups: [[
    artifact("torch", "https://files.pythonhosted.org/packages/a8/e0/ca8354dfb8d834a76da51b06e8248b70fc182bc163540507919124974bdf/torch-2.4.1-cp312-cp312-win_amd64.whl", "ebea70ff30544fc021d441ce6b219a88b67524f01170b1c538d7d3ebb5e7f56c", 199387694),
    artifact("torchvision", "https://files.pythonhosted.org/packages/6b/b2/fd577e1622b43cdeb74782a60cea4909f88f471813c215ea7b4e7ea84a74/torchvision-0.19.1-cp312-cp312-win_amd64.whl", "b4283d283675556bb0eae31d29996f53861b17cbdcdf3509e6bc050414ac9289", 1288328),
    artifact("torch-directml", "https://files.pythonhosted.org/packages/71/f2/eb7d3c601310c758f6aef891773e4a00f7388eeb613d536c0d2681fcb105/torch_directml-0.2.5.dev240914-cp312-cp312-win_amd64.whl", "ea19d11e33e9450b290311c06f7eb10924dd25c555e504d367b7b437d3eb24d0", 8956338),
    artifact("pillow", "https://files.pythonhosted.org/packages/74/0a/d4ce3c44bca8635bd29a2eab5aa181b654a734a29b263ca8efe013beea98/pillow-10.4.0-cp312-cp312-win_amd64.whl", "1d846aea995ad352d4bdcc847535bd56e0fd88d36829d2c90be880ef1ee4668a", 2554951)
  ]],
} as const;

export const DIRECTML_PROBE_LINES = [
    "elif expected == 'directml':",
    "    import torch_directml as dml",
    "    from distributed_runtime.directml import video_memory_budget",
    "    from transformers import AutoTokenizer",
    "    actual = 'directml'",
    "    import warnings; warnings.filterwarnings('error', message='.*fall back.*', category=UserWarning)",
    "    names = [dml.device_name(i).strip('\\0') for i in range(dml.device_count())]",
    "    matches = [i for i, name in enumerate(names) if identity_key(name) == identity_key(expected_device_name)]",
    "    assert len(matches) == 1, f'DirectML adapter identity is absent or ambiguous: {names!r}'",
    "    device = dml.device(matches[0])",
    "    device_name = names[matches[0]]",
    "    sample = torch.arange(32 * 96, dtype=torch.float32).reshape(1, 32, 96).sin()",
    "    weight = torch.arange(96 * 96, dtype=torch.float32).reshape(96, 96).cos() / 96",
    "    expected_linear = torch.nn.functional.linear(sample, weight) + sample",
    "    observed_linear = (torch.nn.functional.linear(sample.to(device), weight.to(device)) + sample.to(device)).cpu()",
    "    assert torch.allclose(observed_linear, expected_linear, rtol=1e-4, atol=1e-4), 'DirectML projection/residual probe disagrees with CPU'",
    "    total_memory, usage = video_memory_budget(device_name)",
    "    synchronize = lambda: torch.empty(1, device=device).cpu()",
    "    allocated_memory = lambda: None",
    "    reserved_memory = lambda: None",
] as const;
