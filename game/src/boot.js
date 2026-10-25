import { showRecovery } from './recovery.js';

// A failed module/resource download must leave a usable recovery screen.
import('./main.js').catch(error => { console.error('游戏启动失败', error); showRecovery(); });
