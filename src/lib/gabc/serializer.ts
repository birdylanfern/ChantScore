import { ChantScore } from '@/src/types/chant';
import { serializeGabcWithMap } from './sourceMap';

/**
 * Serialize a score to GABC. This is a thin wrapper over serializeGabcWithMap so
 * that the exported file and the editor's source view can never diverge.
 */
export function serializeGabc(score: ChantScore): string {
  return serializeGabcWithMap(score).gabc;
}
