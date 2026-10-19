let counter = 0;

/** Short unique ids; fine for one person's data and safe as a storage path segment. */
export function newId(prefix = ''): string {
  counter = (counter + 1) % 1_679_616;
  const time = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1_679_616).toString(36).padStart(4, '0');
  return `${prefix}${time}${counter.toString(36).padStart(4, '0')}${rand}`;
}
