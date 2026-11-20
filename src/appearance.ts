export const appearances = [
  { id: 'system', label: 'System', description: 'Follow VS Code' },
  { id: 'graphite', label: 'Graphite', description: 'Charcoal and steel blue' },
  { id: 'blueprint', label: 'Blueprint', description: 'Midnight navy and cyan' },
  { id: 'paper', label: 'Paper', description: 'Warm ivory and rust' },
  { id: 'moss', label: 'Moss', description: 'Deep pine and fern' },
  { id: 'violet', label: 'Violet', description: 'Indigo and lavender' },
  { id: 'glacier', label: 'Glacier', description: 'Blue-gray and cobalt' },
  { id: 'ember', label: 'Ember', description: 'Umber and copper' },
  { id: 'plum', label: 'Plum', description: 'Mauve and berry' },
] as const;

export type Appearance = typeof appearances[number]['id'];

export function isAppearance(value: unknown): value is Appearance {
  return appearances.some(appearance => appearance.id === value);
}
