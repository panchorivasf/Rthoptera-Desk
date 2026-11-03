import numpy as np, wave
fs=44100; T=7.0; n=int(fs*T); rng=np.random.default_rng(3)
x=rng.normal(0,0.004,n)
t=np.arange(n)/fs
def pulse(t0,f,dur=0.012,amp=0.5):
    i0=int(t0*fs); m=int(dur*fs); tt=np.arange(m)/fs
    env=np.sin(np.pi*tt/dur)**2*np.exp(-tt*60)
    x[i0:i0+m]+=amp*env*np.sin(2*np.pi*f*tt)*(1+0.0*tt)
t0=0.3
for e in range(7):
    k=8+(e%2)
    for p in range(k):
        a=0.25+0.5*np.sin(np.pi*(p+.5)/k)
        for j in range(3): pulse(t0+p*0.042+j*0.0045,9200+80*e,dur=0.0035,amp=a*(1-0.15*j))
    t0+=0.42+0.05*(e%3)
x/=np.abs(x).max()/0.8
w=wave.open('demo_song.wav','wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(fs)
w.writeframes((x*32767).astype(np.int16).tobytes()); w.close(); print(t0)
