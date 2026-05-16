import { describe, it, expect } from 'vitest';
import { ensureOffscreen, closeOffscreen } from '../../src/background/offscreen-manager.js';
import { setOffscreenHasDocument } from '../setup.js';

describe('offscreen-manager', () => {
  beforeEach(() => {
    setOffscreenHasDocument(false);
  });

  describe('ensureOffscreen', () => {
    it('creates offscreen document when none exists', async () => {
      await ensureOffscreen();
      expect(chrome.offscreen.hasDocument).toHaveBeenCalled();
      expect(chrome.offscreen.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('offscreen/index.html'),
          reasons: expect.arrayContaining(['AUDIO_PLAYBACK', 'DOM_PARSER']),
          justification: expect.stringContaining('ONNX')
        })
      );
    });

    it('does not create document if already exists', async () => {
      setOffscreenHasDocument(true);
      await ensureOffscreen();
      expect(chrome.offscreen.hasDocument).toHaveBeenCalled();
      expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
    });
  });

  describe('closeOffscreen', () => {
    it('closes document if it exists', async () => {
      setOffscreenHasDocument(true);
      await closeOffscreen();
      expect(chrome.offscreen.closeDocument).toHaveBeenCalled();
    });

    it('does nothing if document does not exist', async () => {
      setOffscreenHasDocument(false);
      await closeOffscreen();
      expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();
    });
  });
});
