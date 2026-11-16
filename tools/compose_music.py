"""Original instrumental loops for Between Worlds. Build only: NumPy + FFmpeg.

The game plays the rendered MP3 files and needs no extra Python packages.
All notes, envelopes, harmonies and stereo echoes are synthesized locally.
"""
from pathlib import Path
import json
import subprocess
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RATE = 32000
THEMES = [
    # world, title, tonal root, tempo, timbre, chord roots, minor, melody
    ('room-v2', 'Свет в твоём окне', 60, 62, 'piano', [0,5,9,7], False, [4,7,9,7,4,2,0,2]),
    ('0', 'Изумрудный порог', 57, 60, 'harp', [0,5,3,7], True, [0,7,10,7,3,5,7,2]),
    ('2', 'Тёплое сердце пламени', 50, 76, 'plucked', [0,3,5,7], True, [0,3,7,10,7,5,3,2]),
    ('3', 'Лес, который помнит', 62, 68, 'harp', [0,7,9,5], False, [2,7,9,14,9,7,4,2]),
    ('4', 'Песня речной долины', 65, 66, 'harp', [0,5,9,7], False, [0,4,7,12,11,7,4,2]),
    ('5', 'Розы под землёй', 57, 64, 'piano', [0,5,3,7], True, [7,10,12,10,7,3,5,2]),
    ('6', 'На полях созвездий', 64, 54, 'bell', [0,5,9,7], False, [4,11,14,19,14,11,7,4]),
    ('7', 'Тишина хрустального дворца', 47, 54, 'piano', [0,3,5,7], True, [0,3,7,10,7,5,3,0]),
    ('8', 'Час, который не кончается', 55, 56, 'piano', [0,5,3,7], True, [7,3,2,0,7,10,7,5]),
    ('9', 'Шёпот забытых имён', 52, 58, 'glass', [0,5,3,7], True, [0,3,7,2,0,10,7,3]),
    ('10', 'Отражённый лунный свет', 62, 56, 'bell', [0,5,3,7], True, [0,7,10,14,12,10,7,5]),
    ('11', 'Между мирами', 60, 60, 'harp', [0,9,5,7], False, [0,7,9,12,11,7,4,2]),
]


def compose(theme):
    world, title, root, bpm, voice, progression, minor, melody = theme
    beat = 60 / bpm
    duration = 64 * beat
    size = round(duration * RATE)
    mix = np.zeros((size, 2), np.float64)

    def note(midi, start, length, amp, pan, kind):
        t = np.arange(round(length * RATE)) / RATE
        freq = 440 * 2 ** ((midi-69)/12)
        phase = 2*np.pi*freq*t
        if kind == 'pad':
            env = np.sin(np.pi*np.minimum(t/length, 1))**1.5
            wave = (np.sin(phase)*.58 + np.sin(phase*1.0015)*.27 + np.sin(phase*2)*.1)
        else:
            decay = {'harp':1.2, 'piano':1.7, 'plucked':.8, 'bell':2.5, 'glass':3.2}[kind]
            env = (1-np.exp(-t*120))*np.exp(-t/decay)
            env *= np.minimum((length-t)/.3, 1).clip(0,1)
            wave = np.sin(phase) + .27*np.sin(phase*2)*np.exp(-t*2) + .1*np.sin(phase*3)*np.exp(-t*3)
            if kind in ('bell','glass'):
                wave += .15*np.sin(phase*2.003)*np.exp(-t/1.3)
        sample = wave*env*amp
        indices = (round(start*RATE)+np.arange(len(t))) % size
        mix[indices,0] += sample*np.sqrt((1-pan)/2)
        mix[indices,1] += sample*np.sqrt((1+pan)/2)

    for bar in range(16):
        degree = progression[(bar//2)%4]
        chord = root-12+degree
        # Diatonic thirds for the chosen major or natural-minor key.
        third = (3 if degree in (0,5) else 4) if minor else (3 if degree==9 else 4)
        for i, interval in enumerate((0,third,7,12)):
            note(chord+interval, bar*4*beat, 5.5*beat, .08, (i-1.5)*.3, 'pad')
        arp = (0,7,12,third+12)
        for j in range(4):
            note(chord+12+arp[(j+bar%2)%4], (bar*4+j+.12)*beat,
                 3.5, .075 if voice!='plucked' else .105, (-1 if j%2 else 1)*.38, voice)
        if bar%2==0:
            # A recognisable eight-note phrase, with room between its answers.
            degree_m = melody[(bar//2)%8]
            note(root+12+degree_m, (bar*4+.5)*beat, 4.8, .135, -.12, voice)
        elif bar%4==3:
            note(root+12+melody[((bar-1)//2+1)%8], (bar*4+2)*beat, 3.8, .085, .2, voice)
        if world=='2':
            note(root-24, bar*4*beat, 1.4, .11, 0, 'plucked')
    # Circular echoes preserve tails across the loop boundary.
    dry=mix.copy()
    for delay,gain in ((.193,.16),(.367,.12),(.613,.09),(1.07,.065),(1.79,.035)):
        mix += np.roll(dry[:,::-1],round(delay*RATE),axis=0)*gain
    rms=float(np.sqrt(np.mean(mix*mix)))
    mix *= min(.105/max(rms,1e-8), .82/np.max(np.abs(mix)))
    output=ROOT/'assets/music'/f'{world}.mp3'
    output.parent.mkdir(parents=True,exist_ok=True)
    subprocess.run(['ffmpeg','-y','-v','error','-f','f32le','-ar',str(RATE),'-ac','2','-i','-',
                    '-c:a','libmp3lame','-b:a','160k','-metadata',f'title={title}',
                    '-metadata','artist=Между мирами — оригинальная инструментальная тема',str(output)],
                   input=mix.astype('<f4').tobytes(),check=True)
    return {'world':world,'title':title,'file':f'assets/music/{world}.mp3','bpm':bpm,
            'seconds':round(duration,2),'peak':round(float(np.max(np.abs(mix))),4),
            'rms':round(float(np.sqrt(np.mean(mix*mix))),4)}


if __name__=='__main__':
    report=[]
    for theme in THEMES:
        report.append(compose(theme))
        print(theme[0], 'rendered', flush=True)
    (ROOT/'assets/music/manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
