import type { JourneyMedia } from '../types';
export const mediaDay = (item: JourneyMedia) => new Date(item.takenMs + 9 * 3600000).toISOString().slice(0, 10);
export function filterLibrary(media: JourneyMedia[], query: string, day: string, inclusion: string, excluded: Set<string>) {
  const words = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return media.filter(item => {
    const name = `${item.title} ${item.sourceName ?? item.file?.name ?? ''}`.normalize('NFKC').toLocaleLowerCase().replace(/[_-]+/g, ' ');
    return words.every(word => name.includes(word.replace(/[_-]+/g, ' '))) && (!day || mediaDay(item) === day)
      && (inclusion === 'ALL' || excluded.has(item.id) === (inclusion === 'EXCLUDED'));
  });
}
