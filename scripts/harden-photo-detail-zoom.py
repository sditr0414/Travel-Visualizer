from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old, new, 1)


path = Path('src/player/player-controller.ts')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "const PHOTO_DETAIL_ZOOM_STRENGTH_MAX = 1.5;\n",
    "const PHOTO_DETAIL_ZOOM_STRENGTH_MAX = 1.5;\nconst PHOTO_JOURNEY_MAX_ZOOM_BOOST = 3.5;\n",
    'photo journey boost max constant'
)
text = replace_once(
    text,
    "    const target = clamp(Number(targetBoost) || 0, 0, 2);\n",
    "    const target = clamp(Number(targetBoost) || 0, 0, PHOTO_JOURNEY_MAX_ZOOM_BOOST);\n",
    'free journey target clamp'
)
text = replace_once(
    text,
    "    this.displayedFreeJourneyZoomBoost = clamp(this.displayedFreeJourneyZoomBoost + step, 0, 2);\n",
    "    this.displayedFreeJourneyZoomBoost = clamp(this.displayedFreeJourneyZoomBoost + step, 0, PHOTO_JOURNEY_MAX_ZOOM_BOOST);\n",
    'free journey state clamp'
)
path.write_text(text, encoding='utf-8')

path = Path('src/player/player-controller.test.ts')
text = path.read_text(encoding='utf-8')
anchor = """  it('continues easing closer while a short-route photo is on screen', () => {
"""
test = """  it('keeps photo detail strength effective in unlocked cinematic mode without saturating at the legacy boost cap', () => {
    const plan = simplePlan();
    plan.durationSec = 60;
    plan.durationLimits.extentKm = 2;
    const jumpTo = vi.fn();
    const map = { getSource: () => ({ setData: vi.fn() }), jumpTo } as unknown as Map;
    const controller = new PlayerController(map);
    controller.setLockToPosition(false);
    controller.setPhotoDetailZoomStrength(0.5);
    controller.loadPlan(plan, [{ id: 'photo', atSec: 0, durationSec: 60 }]);
    const low = (jumpTo.mock.calls.at(-1)?.[0] as { zoom: number }).zoom;

    controller.setPhotoDetailZoomStrength(1.5);
    const high = (jumpTo.mock.calls.at(-1)?.[0] as { zoom: number }).zoom;
    expect(high).toBeGreaterThan(low + 0.6);
  });

"""
text = replace_once(text, anchor, test + anchor, 'unlocked detail strength test')
path.write_text(text, encoding='utf-8')
