import { bindPlaybackTap } from './playback-tap';

function pointer(target: EventTarget, type: string, options: Record<string, unknown> = {}) {
  const event = new MouseEvent(type, { bubbles: true, clientX: 100, clientY: 100 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true, ...options })) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
}

describe('map playback tap', () => {
  let surface: HTMLDivElement, canvas: HTMLCanvasElement, dispose: () => void;
  const toggle = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers(); toggle.mockClear();
    surface = document.createElement('div'); canvas = document.createElement('canvas'); surface.append(canvas); document.body.append(surface);
    dispose = bindPlaybackTap(surface, toggle);
  });
  afterEach(() => { dispose(); surface.remove(); vi.useRealTimers(); });
  const finish = () => vi.advanceTimersByTime(600);

  it.each(['mouse', 'touch'])('toggles once for a single %s tap', pointerType => {
    pointer(canvas, 'pointerdown', { pointerType }); pointer(canvas, 'pointerup', { pointerType });
    expect(toggle).not.toHaveBeenCalled(); finish(); expect(toggle).toHaveBeenCalledTimes(1);
  });
  it('ignores a drag even when it returns to its starting position', () => {
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientX: 150 }); pointer(canvas, 'pointerup');
    finish(); expect(toggle).not.toHaveBeenCalled();
  });
  it('leaves double taps and multi-touch to map zoom', () => {
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerup'); vi.advanceTimersByTime(200);
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerup'); finish();
    pointer(canvas, 'pointerdown', { pointerType: 'touch' });
    pointer(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 2, isPrimary: false });
    pointer(canvas, 'pointerup'); pointer(canvas, 'pointerup', { pointerId: 2 }); finish();
    expect(toggle).not.toHaveBeenCalled();
  });
  it.each(['wheel', 'keydown', 'blur', 'pointercancel'])('cancels a pending tap on %s', type => {
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerup');
    canvas.dispatchEvent(new Event(type, { bubbles: true })); finish(); expect(toggle).not.toHaveBeenCalled();
  });
  it('does not toggle for controls, long presses or modifier clicks', () => {
    const button = document.createElement('button'); surface.append(button);
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerup'); pointer(button, 'pointerdown'); pointer(button, 'pointerup'); finish();
    pointer(canvas, 'pointerdown', { timeStamp: 100 }); pointer(canvas, 'pointerup', { timeStamp: 900 }); finish();
    pointer(canvas, 'pointerdown', { shiftKey: true }); pointer(canvas, 'pointerup'); finish();
    expect(toggle).not.toHaveBeenCalled();
  });
  it('cannot start during loading or after disposal', () => {
    dispose(); let enabled = false; dispose = bindPlaybackTap(surface, toggle, () => enabled);
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerup'); enabled = true; finish();
    expect(toggle).not.toHaveBeenCalled();
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerup'); dispose(); finish();
    expect(toggle).not.toHaveBeenCalled();
  });
});
