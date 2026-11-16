import type { CivId, Command, GameInit, GameOverInfo, Snapshot } from './types';

export interface SlotInfo {
  slot: number;
  name: string;
  civ: CivId | 'random';
  color: number;
  isAI: boolean;
  clientId?: string;
  ready?: boolean;
}

export interface RoomState {
  id: string;
  name: string;
  hostId: string;
  slots: SlotInfo[];
  status: 'lobby' | 'playing';
  maxPlayers: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  players: number;
  maxPlayers: number;
  status: 'lobby' | 'playing';
  host: string;
}

export type ClientMsg =
  | { type: 'hello'; name: string }
  | { type: 'listRooms' }
  | { type: 'createRoom'; name: string }
  | { type: 'joinRoom'; roomId: string }
  | { type: 'leaveRoom' }
  | { type: 'setCiv'; civ: CivId | 'random'; slot?: number }
  | { type: 'setColor'; color: number; slot?: number }
  | { type: 'addAI' }
  | { type: 'removeSlot'; slot: number }
  | { type: 'startGame' }
  | { type: 'cmd'; cmd: Command }
  | { type: 'chat'; text: string }
  | { type: 'resign' };

export type ServerMsg =
  | { type: 'welcome'; id: string }
  | { type: 'rooms'; rooms: RoomSummary[] }
  | { type: 'room'; room: RoomState | null }
  | { type: 'error'; message: string }
  | { type: 'gameStart'; init: GameInit }
  | { type: 'snap'; s: Snapshot }
  | { type: 'gameOver'; info: GameOverInfo }
  | { type: 'chat'; from: string; text: string; color?: number };
