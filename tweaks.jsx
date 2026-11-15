// tweaks.jsx — Tweaks panel for Being Trained
// Uses helpers from tweaks-panel.jsx

const DEFAULTS = window.BT_CONFIG;

function BTApp() {
  const [t, setTweak] = useTweaks(DEFAULTS);

  // push into engine when values change
  React.useEffect(() => {
    if (window.BT) window.BT.setConfig(t);
  }, [t]);

  return (
    <TweaksPanel title="Tweaks · 调">
      <TweakSection label="手势 · Gesture" />
      <TweakToggle label="镜像手部 Mirror"
                   value={t.handMirror}
                   onChange={(v) => setTweak('handMirror', v)} />
      <TweakSlider label="平滑 Smoothing" value={t.handSmoothing}
                   min={0} max={0.9} step={0.05}
                   onChange={(v) => setTweak('handSmoothing', v)} />
      <TweakSlider label="识别灵敏度 Sensitivity" value={t.gestureSensitivity}
                   min={0.2} max={1} step={0.05}
                   onChange={(v) => setTweak('gestureSensitivity', v)} />
      <TweakToggle label="显示手骨架 Skeleton"
                   value={t.showSkeleton}
                   onChange={(v) => setTweak('showSkeleton', v)} />

      <TweakSection label="氛围 · Atmosphere" />
      <TweakToggle label="墨色呼吸 Ink breathing"
                   value={t.inkBreath}
                   onChange={(v) => setTweak('inkBreath', v)} />
      <TweakSlider label="粒子密度 Density" value={t.particleDensity}
                   min={0.2} max={1.5} step={0.1}
                   onChange={(v) => setTweak('particleDensity', v)} />
      <TweakToggle label="双语 Bilingual"
                   value={t.bilingual}
                   onChange={(v) => setTweak('bilingual', v)} />
      <TweakColor  label="朱砂 Accent" value={t.accent}
                   onChange={(v) => setTweak('accent', v)} />

      <TweakSection label="声音 · Sound" />
      <TweakToggle label="启用 Sound on"
                   value={t.sound}
                   onChange={(v) => setTweak('sound', v)} />
      <TweakSlider label="音量 Volume" value={t.soundVolume}
                   min={0} max={1} step={0.05}
                   onChange={(v) => setTweak('soundVolume', v)} />

      <TweakSection label="流 · Flow" />
      <TweakButton label="回到起点 Reset"
                   onClick={() => window.restartToTop && window.restartToTop()} />
    </TweaksPanel>
  );
}

const __btHost = document.createElement('div');
__btHost.id = 'tweaks-host';
document.body.appendChild(__btHost);
ReactDOM.createRoot(__btHost).render(<BTApp />);
