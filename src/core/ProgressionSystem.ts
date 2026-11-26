import dialogueData from '../data/dialogue.json';

export type QuestStage = 'alley_ambush' | 'speak_survivors' | 'assault_castle' | 'completed';

export interface DialogueEntry {
  speaker: string;
  default: string[];
  quest_active: string[];
  quest_cleared_light: string[];
  quest_cleared_poison: string[];
  high_corruption: string[];
  high_virtue: string[];
}

export type DialogueBucket = Exclude<keyof DialogueEntry, 'speaker'>;

const DIALOGUE = dialogueData as Record<string, DialogueEntry>;

const NODE_CORRUPTION_GAIN = 30;
const SHRINE_VIRTUE_GAIN = 30;
const SHRINE_HEAL = 30;
const MAX_ALIGNMENT = 100;

/**
 * Owns the Act 1 dual-alignment progression (Poison / Corruption vs. Light /
 * Virtue) plus the "The Tainted Catch" quest stage. Pure state — it reads
 * `dialogue.json` for text and reports healing back through a handler the
 * engine wires to the player stats.
 */
export class ProgressionSystem {
  corruption = 0;
  virtue = 0;
  readonly absorbedNodeIds = new Set<string>();
  readonly purifiedShrineIds = new Set<string>();
  questStage: QuestStage = 'alley_ambush';

  private healHandler: ((amount: number) => void) | null = null;

  setHealHandler(handler: (amount: number) => void): void {
    this.healHandler = handler;
  }

  /** Absorb a poison node: +30 corruption, marks it spent, unlocks Blight Dash. */
  absorbPoisonNode(entityId: string): boolean {
    if (this.absorbedNodeIds.has(entityId)) return false;
    this.absorbedNodeIds.add(entityId);
    this.corruption = Math.min(MAX_ALIGNMENT, this.corruption + NODE_CORRUPTION_GAIN);
    return true;
  }

  /** Purify a light shrine: +30 virtue, marks it purified, heals the player. */
  purifyLightShrine(entityId: string): boolean {
    if (this.purifiedShrineIds.has(entityId)) return false;
    this.purifiedShrineIds.add(entityId);
    this.virtue = Math.min(MAX_ALIGNMENT, this.virtue + SHRINE_VIRTUE_GAIN);
    this.healHandler?.(SHRINE_HEAL);
    return true;
  }

  /** Select the right dialogue bucket for an NPC based on quest + alignment. */
  getDialogueLines(npcAssetId: string): { speaker: string; lines: string[] } {
    const entry = DIALOGUE[npcAssetId];
    if (!entry) {
      return { speaker: npcAssetId, lines: ['…'] };
    }
    // The Ronin's pre-fight + phase-two speeches are always his fixed lines.
    if (npcAssetId === 'npc_ronin' || npcAssetId === 'npc_ronin_phase2') {
      return { speaker: entry.speaker, lines: entry.default };
    }
    const bucket = this.selectBucket();
    return { speaker: entry.speaker, lines: entry[bucket] ?? entry.default };
  }

  reset(): void {
    this.corruption = 0;
    this.virtue = 0;
    this.absorbedNodeIds.clear();
    this.purifiedShrineIds.clear();
    this.questStage = 'alley_ambush';
  }

  private selectBucket(): DialogueBucket {
    const corruptionDominant = this.corruption > this.virtue;
    const virtueDominant = this.virtue > this.corruption;

    switch (this.questStage) {
      case 'completed':
        return corruptionDominant ? 'quest_cleared_poison' : 'quest_cleared_light';
      case 'alley_ambush':
      case 'speak_survivors':
      case 'assault_castle':
        return 'quest_active';
      default:
        if (this.corruption >= 30 && corruptionDominant) return 'high_corruption';
        if (this.virtue >= 30 && virtueDominant) return 'high_virtue';
        return 'default';
    }
  }
}
