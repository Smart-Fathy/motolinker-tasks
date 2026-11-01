// The conversations: one for each section, in the order things were said, kept for as long as the app is open (the classic panel keeps
// them in memory too: a reload starts them again). A pure reducer, so that what becomes of a proposal, a question and its answer is
// stated once and tested without a screen.
import type { ProposalState, Turn } from './model';

export type Conversations = Readonly<Record<string, readonly Turn[]>>;

export type Move =
  /** the person asked */
  | { type: 'asked'; section: string; content: string }
  /** the assistant answered (or said it could not) */
  | { type: 'answered'; section: string; turn: Turn }
  /** a proposal in an answer was confirmed, failed or put away */
  | {
      type: 'proposal';
      section: string;
      turn: number;
      proposal: number;
      patch: Partial<ProposalState>;
    }
  /** a new conversation in this section */
  | { type: 'new'; section: string };

const turnsOf = (state: Conversations, section: string): readonly Turn[] => state[section] ?? [];

export function reduce(state: Conversations, move: Move): Conversations {
  switch (move.type) {
    case 'asked':
      return {
        ...state,
        [move.section]: [...turnsOf(state, move.section), { role: 'user', content: move.content }],
      };
    case 'answered':
      return { ...state, [move.section]: [...turnsOf(state, move.section), move.turn] };
    case 'new':
      return { ...state, [move.section]: [] };
    case 'proposal': {
      const turns = turnsOf(state, move.section);
      const turn = turns[move.turn];
      const proposal = turn?.meta?.proposals[move.proposal];
      if (!turn?.meta || !proposal) return state;
      const proposals = turn.meta.proposals.map((p, i) =>
        i === move.proposal ? { ...p, ...move.patch } : p,
      );
      return {
        ...state,
        [move.section]: turns.map((t, i) =>
          i === move.turn ? { ...turn, meta: { ...turn.meta!, proposals } } : t,
        ),
      };
    }
  }
}
