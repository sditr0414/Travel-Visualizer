import type { Map } from 'maplibre-gl';
import { PlayerController, mapJourneyTime } from './player-controller';
import { simplePlan } from '../test/fixtures';

describe('photo journey stops', () => {
  const stops = [{ id: 'a', atSec: 10, durationSec: 3 }, { id: 'b', atSec: 20, durationSec: 5 }];

  it('holds route time while a media stop is active', () => {
    expect(mapJourneyTime(11, stops, 60)).toEqual({ routeTimeSec: 10, activeStopId: 'a' });
    expect(mapJourneyTime(15, stops, 60)).toEqual({ routeTimeSec: 12, activeStopId: null });
    expect(mapJourneyTime(25, stops, 60)).toEqual({ routeTimeSec: 20, activeStopId: 'b' });
    expect(mapJourneyTime(31, stops, 60)).toEqual({ routeTimeSec: 23, activeStopId: null });
  });

  it('caches the total stop duration when stops change', () => {
    const map = {
      getSource: () => ({ setData: vi.fn() }),
      jumpTo: vi.fn()
    } as unknown as Map;
    const controller = new PlayerController(map);
    const plan = simplePlan();
    controller.loadPlan(plan, stops);
    expect(controller.getDuration()).toBe(plan.durationSec + 8);
    controller.setStops([{ id: 'only', atSec: 1, durationSec: 2 }]);
    expect(controller.getDuration()).toBe(plan.durationSec + 2);
  });
});
