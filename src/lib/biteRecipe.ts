import eatingAudio from '../data/eating-audio.json';

export function biteRecipe(dishId: string, bites: number) {
  const stages = eatingAudio[dishId as keyof typeof eatingAudio];
  if (!stages || !Number.isInteger(bites) || bites < 1 || bites > 12) return null;
  const stage = Math.floor((bites - 1) / 3);
  const role = (bites - 1) % 3;
  const take = stages[stage];
  const file = role === 0 ? 'bite' : role === 2 ? 'finish' : stage % 2 === 0 ? 'chew-1' : 'chew-2';
  return { url: take[file], stage };
}

export function biteUrls(dishId: string): string[] {
  const stages = eatingAudio[dishId as keyof typeof eatingAudio];
  return stages ? [...new Set(stages.flatMap(stage => Object.values(stage)))] : [];
}
