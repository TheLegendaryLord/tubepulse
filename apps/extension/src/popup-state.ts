import type { NativeStatus, PublicActivity } from '@tubepulse/shared';

export const POPUP_PORT = 'tubepulse-popup';

export interface PopupState {
  youtubeDetected: boolean;
  companion: 'idle' | 'connecting' | 'ready' | 'unavailable' | 'off';
  discord: NativeStatus['discord'];
  published: boolean;
  detail: string;
  activity: PublicActivity | null;
}
