import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
import json, hashlib, time, subprocess, argparse
from pathlib import Path
import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True, help='Local official Qwen3-TTS-12Hz-0.6B-CustomVoice directory')
parser.add_argument('--output', default=str(root/'output/qwen3-voice-library'))
args = parser.parse_args()
out = Path(args.output).resolve()
assert out != root/'assets/voice', 'Generate into a staging folder, not bundled assets'
model_path = Path(args.model).resolve()
assert hashlib.sha256((model_path/'model.safetensors').read_bytes()).hexdigest() == 'bc3c7e785eb961179c25450d1acff03f839e0002f2f3a5aeb67b5735c0fa2adb', 'Unexpected model checkpoint'
out.mkdir(exist_ok=True)
catalog = json.loads((root/'assets/voice/catalog.json').read_text(encoding='utf-8'))
torch.set_num_threads(6)
model = Qwen3TTSModel.from_pretrained(str(model_path),
    device_map='cuda:0', dtype=torch.bfloat16, attn_implementation='sdpa', local_files_only=True)
records = []
for speaker in ['Serena', 'Vivian', 'Uncle_Fu', 'Dylan']:
    directory = out/speaker.lower()
    directory.mkdir(exist_ok=True)
    for index, (clip, text) in enumerate(catalog['clips'].items()):
        target = directory/f'{clip}.mp3'
        receipt = directory/f'{clip}.json'
        if target.exists() and receipt.exists():
            item = json.loads(receipt.read_text())
            if item['text'] == text and hashlib.sha256(target.read_bytes()).hexdigest() == item['sha256']:
                records.append(item); continue
        for attempt in range(4):
            torch.manual_seed(20261006 + index + attempt*1000)
            tick = time.time()
            with torch.inference_mode():
                wavs, sr = model.generate_custom_voice(text=text.rstrip('，。！？')+'。', language='Chinese',
                    speaker=speaker, max_new_tokens=240, do_sample=True)
            wav = np.asarray(wavs[0], dtype=np.float32)
            # Keep 60 ms padding, reject suspiciously long/repeated output rather than trimming speech.
            active = np.flatnonzero(np.abs(wav) > .008)
            if len(active): wav = wav[max(0,int(active[0])-int(.06*sr)):min(len(wav),int(active[-1])+int(.06*sr))]
            duration = len(wav)/sr
            numeric = clip.startswith('n') and clip != 'number_unavailable'
            limit = 2.2 if numeric else max(3, len(text)*.42+1.5)
            if not np.isfinite(wav).all() or not len(active) or not .15 <= duration <= min(14,limit):
                sf.write(directory/f'{clip}-rejected-{attempt}.wav', wav, sr)
                print(json.dumps({'retry':speaker+'/'+clip,'duration':duration,'attempt':attempt}), flush=True)
                continue
            raw = directory/f'{clip}.wav'
            sf.write(raw,wav,sr,subtype='PCM_16')
            subprocess.run(['ffmpeg','-v','error','-y','-i',str(raw),'-af','loudnorm=I=-18:TP=-1.5:LRA=7',
                '-ar','24000','-ac','1','-c:a','libmp3lame','-b:a','64k',str(target)],check=True)
            item={'id':clip,'speaker':speaker.lower(),'file':speaker.lower()+'/'+clip+'.mp3','text':text,
                'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
                'duration':round(duration,3),'generationSeconds':round(time.time()-tick,2),'seed':20261006+index+attempt*1000}
            receipt.write_text(json.dumps(item,ensure_ascii=False,indent=2)+'\n')
            records.append(item)
            print(json.dumps({'completed':len(records),'total':204,'file':item['file'],'duration':duration}),flush=True)
            break
        else:
            raise RuntimeError('Audio quality checks exhausted: '+speaker+'/'+clip)
(out/'manifest.json').write_text(json.dumps({'version':3,'language':'zh-CN','engine':'Qwen3-TTS-12Hz-0.6B-CustomVoice',
    'modelSha256':'bc3c7e785eb961179c25450d1acff03f839e0002f2f3a5aeb67b5735c0fa2adb',
    'files':records},ensure_ascii=False,indent=2)+'\n')
print('LIBRARY_COMPLETE',flush=True)
