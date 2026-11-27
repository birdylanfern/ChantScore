export interface VulgateEntry {
  id: string;
  label: string;
  group: 'psalm' | 'canticle';
}

type SplitSpec = number[] | Record<string, number[]>;
type JoinSpec = Record<string, string[]>;

/**
 * Liturgical psalm divisions and monastic joins matching bbloomf/jgabc.
 */
const SPLIT_PSALMS_MAP: Record<string, SplitSpec> = {
  '7': [10, 8],
  '9': {
    '': [10, 11, 13, 8],
    monastic: [19, 23],
  },
  '17': {
    '': [18, 19, 17],
    monastic: [27, 27],
  },
  '18': [7, 9],
  '21': [11, 12, 11],
  '24': [8, 7, 8],
  '26': [11, 9],
  '30': [10, 12, 9],
  '32': [11, 11],
  '33': [10, 12],
  '34': [12, 8, 12],
  '36': [16, 15, 11],
  '37': [10, 13],
  '39': [7, 11, 6],
  '41': [7, 9],
  '43': [10, 11, 7],
  '44': [11, 9],
  '48': [12, 9],
  '49': [16, 8],
  '54': [17, 10],
  '58': [10, 10],
  '65': [11, 8],
  '67': [11, 14, 13],
  '68': [16, 17, 9],
  '70': [13, 13],
  '71': [8, 12],
  '72': [9, 8, 11],
  '73': [10, 8, 6],
  '75': [6, 6],
  '76': [12, 8],
  '77': [11, 8, 16, 11, 18, 14],
  '79': [8, 12],
  '83': [7, 6],
  '88': [18, 18, 15],
  '93': [11, 12],
  '101': [13, 10, 6],
  '102': [12, 10],
  '103': [13, 11, 12],
  '104': [15, 11, 18],
  '105': [16, 15, 16],
  '106': [14, 16, 13],
  '108': [12, 8, 10],
  '118': {
    '': [16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16],
    monastic: [
      8, 8, 8, 8,
      8, 8, 8,
      8, 8, 8,
      8, 8, 8,
      8, 8, 8,
      8, 8, 8,
      8, 8, 8,
    ],
  },
  '135': [9, 18],
  '138': {
    '': [12, 11],
    'monastic, Thursday Vespers': [9, 14],
  },
  '142': {
    'Saturday Lauds, divided on feast days only': [8, 6],
  },
  '143': [9, 9],
  '144': {
    '': [7, 6, 9],
    monastic: [9, 13],
  },
};

const JOIN_PSALMS_MAP: Record<string, JoinSpec> = {
  '115': {
    'monastic, Monday Vespers': ['116'],
  },
  '148': {
    'monastic, Lauds': ['149&150'],
  },
};

export const VULGATE_CANTICLES: { id: string; label: string }[] = [
  { id: 'Benedictus', label: 'Benedíctus (Lc 1, 68-79)' },
  { id: 'Magnificat', label: 'Magníficat (Lc 1, 46-55)' },
  { id: 'Nunc dimittis', label: 'Nunc dimíttis (Lc 2, 29-32)' },
  { id: 'Canticum Trium puerorum', label: 'Cánticum Trium puerórum (Dan 3)' },
];

export function listVulgateEntries(): VulgateEntry[] {
  const entries: VulgateEntry[] = [];
  for (let i = 1; i <= 150; i++) {
    const key = String(i);
    entries.push({ id: key, label: key, group: 'psalm' });
    const splitSpec = SPLIT_PSALMS_MAP[key];
    if (splitSpec) {
      const variants: Record<string, number[]> = Array.isArray(splitSpec)
        ? { '': splitSpec }
        : splitSpec;
      for (const [variantName, counts] of Object.entries(variants)) {
        for (let j = 0; j < counts.length; j++) {
          const id = `${i}.${j + 1}${variantName ? ` (${variantName})` : ''}`;
          entries.push({ id, label: id, group: 'psalm' });
        }
      }
    }
    const joinSpec = JOIN_PSALMS_MAP[key];
    if (joinSpec) {
      for (const [variantName, targets] of Object.entries(joinSpec)) {
        for (const t of targets) {
          const id = `${i} & ${t.split('&').join(' & ')}${variantName ? ` (${variantName})` : ''}`;
          entries.push({ id, label: id, group: 'psalm' });
        }
      }
    }
  }
  for (const c of VULGATE_CANTICLES) {
    entries.push({ id: c.id, label: c.label, group: 'canticle' });
  }
  return entries;
}

export const VULGATE_ENTRIES: VulgateEntry[] = listVulgateEntries();

function sliceSinglePsalm(
  data: Record<string, string>,
  psalmNum: string,
  partIndex: number,
  divisionName: string
): string | null {
  const raw = data[psalmNum];
  if (!raw) return null;
  if (partIndex <= 0) return raw;
  const spec = SPLIT_PSALMS_MAP[psalmNum];
  if (!spec) return null;
  const counts = Array.isArray(spec) ? spec : spec[divisionName];
  if (!counts || partIndex > counts.length) return null;
  let start = 0;
  for (let i = 0; i < partIndex - 1; i++) {
    start += counts[i];
  }
  const end = start + counts[partIndex - 1];
  return raw.split('\n').slice(start, end).join('\n');
}

/**
 * Resolve any Vulgate psalm ID (e.g. "109", "118.1", "9.2 (monastic)",
 * "148 & 149 & 150 (monastic, Lauds)", or a canticle like "Magnificat")
 * from the Vulgate dataset.
 */
export function extractVulgatePsalm(
  data: Record<string, string>,
  rawId: string
): string | null {
  const id = rawId.trim();
  if (!id) return null;

  if (Object.prototype.hasOwnProperty.call(data, id)) {
    return data[id];
  }

  // Strip optional trailing variant label for joined psalms: "148 & 149 & 150 (monastic, Lauds)"
  const joinedMatch = /^(\d+(?:\s*&\s*\d+)+)(?:\s+\([^)]+\))?$/.exec(id);
  if (joinedMatch) {
    const parts = joinedMatch[1].split('&').map((s) => String(Number(s.trim())));
    const texts: string[] = [];
    for (const p of parts) {
      const t = data[p];
      if (!t) return null;
      texts.push(t);
    }
    return texts.join('\n');
  }

  const divMatch = /^(\d+)(?:\.(\d+))?(?:\s+\(([^)]+)\))?$/.exec(id);
  if (divMatch) {
    const num = String(Number(divMatch[1]));
    const partIndex = divMatch[2] ? Number(divMatch[2]) : 0;
    const divisionName = divMatch[3] || '';
    return sliceSinglePsalm(data, num, partIndex, divisionName);
  }

  return null;
}

export async function loadVulgatePsalmText(id: string): Promise<string | null> {
  const { VULGATE_PSALMS_DATA } = await import('./vulgatePsalmsData');
  return extractVulgatePsalm(VULGATE_PSALMS_DATA, id);
}
