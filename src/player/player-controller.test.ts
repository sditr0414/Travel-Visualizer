import { mapJourneyTime } from './player-controller';

describe('photo journey stops', () => {
  const stops = [{ id: 'a', atSec: 10, durationSec: 3 }, { id: 'b', atSec: 20, durationSec: 5 }];

  it('holds route time while a media stop is active', () => {
    expect(mapJourneyTime(11, stops, 60)).toEqual({ routeTimeSec: 10, activeStopId: 'a' });
    expect(mapJourneyTime(15, stops, 60)).toEqual({ routeTimeSec: 12, activeStopId: null });
    expect(mapJourneyTime(25, stops, 60)).toEqual({ routeTimeSec: 20, activeStopId: 'b' });
    expect(mapJourneyTime(31, stops, 60)).toEqual({ routeTimeSec: 23, activeStopId: null });
  });
});
