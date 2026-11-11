$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$demoOutput = Join-Path $PSScriptRoot '..\outputs\cadencia-demo-parts'
New-Item -ItemType Directory -Force -Path $demoOutput | Out-Null
$demoVoice = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $demoVoice.SelectVoice('Microsoft Helena Desktop')
  $demoVoice.Rate = 0
  $demoFormat = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
  $demoPhrases = @('Esta es una demostración de Cadencia.','Aquí dejamos una pausa. Y ahora una vocal larga.','Puedes escuchar cada corte antes de aceptarlo.')
  for ($demoIndex=0; $demoIndex -lt $demoPhrases.Length; $demoIndex++) {
    $demoVoice.SetOutputToWaveFile((Join-Path $demoOutput "$demoIndex.wav"),$demoFormat)
    $demoVoice.Speak($demoPhrases[$demoIndex])
    $demoVoice.SetOutputToNull()
  }
} finally { $demoVoice.Dispose() }
@'
from pathlib import Path
import array, json, math, struct, wave
root=Path.cwd(); parts=root/'outputs/cadencia-demo-parts'; destination=root/'apps/web/public/cadencia'
destination.mkdir(parents=True,exist_ok=True)
def read(name):
 with wave.open(str(parts/name),'rb') as source:
  assert source.getframerate()==16000 and source.getnchannels()==1 and source.getsampwidth()==2
  samples=array.array('h',source.readframes(source.getnframes()))
  # Trim synthetic leading/trailing padding, then add known pauses below.
  indices=[i for i,x in enumerate(samples) if abs(x)>100]
  return samples[max(0,indices[0]-160):min(len(samples),indices[-1]+160)]
output=array.array('h'); spans=[]
def add(kind,values):
 start=len(output)/16000;output.extend(values);spans.append({'kind':kind,'start':start,'end':len(output)/16000})
add('speech',read('0.wav'));add('silence',[0]*16000)
add('speech',read('1.wav'));add('silence',[0]*5600)
# Explicitly synthetic voiced "o"-like harmonic tone, never a claimed human recording.
tone=[]
for i in range(16800):
 t=i/16000;envelope=min(1,t/.025,(1.05-t)/.025)
 value=sum(amp*math.sin(2*math.pi*130*harmonic*t) for harmonic,amp in [(1,.15),(2,.10),(4,.075),(7,.04),(10,.015)])
 tone.append(round(value*max(0,envelope)*32767))
add('synthetic-sustained-vowel',tone);add('silence',[0]*13600);add('speech',read('2.wav'))
with wave.open(str(destination/'demo.wav'),'wb') as target:
 target.setnchannels(1);target.setsampwidth(2);target.setframerate(16000);target.writeframes(output.tobytes())
(destination/'demo-provenance.json').write_text(json.dumps({'synthetic':True,'voice':'Microsoft Helena Desktop, local Windows speech','tone':'locally synthesized harmonics, not a human vowel recording','generator':'scripts/generate-cadencia-demo.ps1','sampleRate':16000,'duration':len(output)/16000,'spans':spans},indent=2),encoding='utf-8')
print('Generated labelled synthetic Cadencia audio demo:',round(len(output)/16000,2),'s')
'@ | python -
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
