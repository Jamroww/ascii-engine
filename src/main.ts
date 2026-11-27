import './style.css';
import { Engine } from './core/Engine';
import { LevelManager } from './core/LevelManager';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

const engine = new Engine(app);
const level = new LevelManager(engine);

engine.setLevelManager(level);

level.loadLevel(LevelManager.createDefaultVillageLevel(), false);

engine.start();

// Dev-only level editor, tree-shaken out of production builds by Vite.
if (import.meta.env.DEV) {
  import('./editor/EditorController').then(({ EditorController }) => {
    new EditorController(engine, level).initialize();
  });
}
