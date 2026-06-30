import { Scene } from 'phaser';
import { SceneKeys } from '@/constants/scenes';
import { AssetKeys } from '@/constants/assets';

/**
 * Boot loads the one asset the Preloader's loading screen needs to
 * render its brand chrome — the V21 logo. Everything else (atlases,
 * theme bgs, sfx, fonts) loads in Preloader against this screen.
 * Keeping Boot's payload to a single ~72KB PNG means the time between
 * "first paint" and "branded loading screen up" is essentially the
 * RTT plus one image decode — typically <100ms on the Devvit CDN.
 */
export class Boot extends Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  preload() {
    this.load.setPath('assets');
    this.load.image(AssetKeys.Image.Logo, 'images/logo.png');
  }

  create() {
    this.scene.start(SceneKeys.Preloader);
  }
}
