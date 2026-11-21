import type { Dispatch, SetStateAction } from "react";

import type { QuestionType } from "~/db/schema";

// The quiz the builder's wizard edits in the browser, before it is saved.

export interface WizardOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface WizardQuestion {
  id: string;
  text: string;
  type: QuestionType;
  options: WizardOption[];
}

export interface WizardState {
  title: string;
  passingScore: number;
  questions: WizardQuestion[];
}

export type SetWizard = Dispatch<SetStateAction<WizardState>>;

export function generateId() {
  return Math.random().toString(36).slice(2, 10);
}
