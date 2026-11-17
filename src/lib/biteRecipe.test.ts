import { describe, expect, it } from 'vitest';
import { biteRecipe, biteUrls } from './biteRecipe';

describe('recorded bite selection', () => {
  for (const dish of ['satay', 'pad-thai', 'mango-rice', 'tom-yum']) {
    it(`${dish}: all twelve bites resolve to shipped stage recordings`, () => {
      for (let bite = 1; bite <= 12; bite++) {
        const recipe = biteRecipe(dish, bite)!;
        expect(recipe.stage).toBe(Math.floor((bite - 1) / 3));
        expect(recipe.url).toMatch(new RegExp(`/${dish}/v[23]/stage-${recipe.stage}/`));
      }
      expect(biteUrls(dish)).toHaveLength(16);
      expect(biteRecipe(dish, 3)!.url).toContain('/stage-0/finish.mp3');
      expect(biteRecipe(dish, 4)!.url).toContain('/stage-1/bite.mp3');
      expect(biteRecipe(dish, 12)!.url).toContain('/stage-3/finish.mp3');
    });
  }
  it('ignores unknown dishes and invalid bite counts', () => {
    expect(biteRecipe('unknown', 1)).toBeNull();
    expect(biteUrls('unknown')).toEqual([]);
    for (const bite of [-1, 0, 13, NaN, 1.5]) expect(biteRecipe('satay', bite)).toBeNull();
  });
});
