/**
 * Socket.IO singleton for real-time communication
 * Imported by views that need socket access
 */

import { createSocket } from './state.js?v=1776342458439';
import { getAuthToken } from './api.js?v=1776342458439';

export const socket = createSocket(getAuthToken());
