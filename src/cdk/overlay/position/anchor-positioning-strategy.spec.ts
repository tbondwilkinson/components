import {ComponentPortal, PortalModule} from '@angular/cdk/portal';
import {TestBed, inject} from '@angular/core/testing';
import {Component, NgZone} from '@angular/core';
import {
  Overlay,
  OverlayContainer,
  OverlayRef,
  OverlayModule,
  OverlayConfig,
  AnchorPositioningStrategy,
} from '../index';
import {MockNgZone} from '@angular/cdk/testing/private';
import {Platform} from '@angular/cdk/platform';

fdescribe('AnchorPositioningStrategy', () => {
  let overlay: Overlay;
  let overlayContainer: OverlayContainer;
  let platform: Platform;
  let zone: MockNgZone;
  let overlayRef: OverlayRef;
  let styles: HTMLStyleElement;

  beforeAll(() => {
    const styles = document.createElement('style') as HTMLStyleElement;
    styles.innerHTML = `
      @position-fallback --default-position {
        @try {
          inset-inline-start: anchor(self-start);
          top: anchor(bottom);
        }
      }

      .anchor {
        width: 200px;
        height: 200px;
        background-color: rebeccapurple;
        anchor-name: --anchor;
      }

      .overlay-content {
        width: 100px;
        height: 100px;
        background-color: pink;
      }
    `;
    document.head.appendChild(styles);
  });

  afterAll(() => {
    styles.remove();
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OverlayModule, PortalModule],
      declarations: [TestOverlayContent],
      providers: [{provide: NgZone, useFactory: () => (zone = new MockNgZone())}],
    });

    inject(
      [Overlay, OverlayContainer, Platform],
      (o: Overlay, oc: OverlayContainer, p: Platform) => {
        overlay = o;
        overlayContainer = oc;
        platform = p;
      },
    )();
  });

  afterEach(() => {
    overlayContainer.ngOnDestroy();
    if (overlayRef) {
      overlayRef.dispose();
    }
  });

  function createAnchorPositioningStrategy() {
    return new AnchorPositioningStrategy('anchor', platform).withPositionFallback(
      'default-position',
    );
  }

  function createOverlay(config: OverlayConfig) {
    overlayRef = overlay.create(config);
  }

  function attachOverlay() {
    overlayRef.attach(new ComponentPortal(TestOverlayContent));
    zone.simulateZoneExit();
  }

  it('should throw when attempting to attach to multiple different overlays', () => {
    const {anchorContainer} = createAnchorElements();
    document.body.appendChild(anchorContainer);
    const positionStrategy = createAnchorPositioningStrategy();
    createOverlay({positionStrategy});
    attachOverlay();

    expect(() => attachOverlay()).toThrow();
    anchorContainer.remove();
  });

  it('should not throw when trying to apply after being disposed', () => {
    const {anchorContainer} = createAnchorElements();
    document.body.appendChild(anchorContainer);
    const positionStrategy = createAnchorPositioningStrategy();

    createOverlay({positionStrategy});
    attachOverlay();
    overlayRef.dispose();

    expect(() => positionStrategy.apply()).not.toThrow();
    anchorContainer.remove();
  });

  it('should clean up after itself when disposed', () => {
    const {anchorContainer} = createAnchorElements();
    document.body.appendChild(anchorContainer);
    const positionStrategy = createAnchorPositioningStrategy();

    createOverlay({positionStrategy});
    const pane = overlayRef.overlayElement;
    const originalPanePosition = 'absolute';
    pane.style.position = originalPanePosition;

    attachOverlay();

    overlayRef.dispose();

    expect(pane.style.anchorDefault).toBeFalsy();
    expect(pane.style.positionFallback).toBeFalsy();
    expect(pane.style.position).toBe(originalPanePosition);
    expect(pane.anchorElement).toBeFalsy();
    anchorContainer.remove();
  });

  describe('positioning', () => {
    let anchorContainer: HTMLElement;
    let anchor: HTMLElement;
    let positionStrategy: AnchorPositioningStrategy;

    beforeEach(() => {
      ({anchor, anchorContainer} = createAnchorElements());
      document.body.appendChild(anchorContainer);
      positionStrategy = createAnchorPositioningStrategy();
      createOverlay({positionStrategy});
      attachOverlay();
    });

    afterEach(() => {
      anchorContainer.remove();
    });

    describe('in ltr', () => {
      it('should use `left` when positioning an element at the start', () => {
        const anchorClientRect = anchor.getBoundingClientRect();
        const overlayClientRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(anchorClientRect.left).toEqual(overlayClientRect.left);
        expect(anchorClientRect.right).not.toEqual(overlayClientRect.right);
        expect(anchorClientRect.bottom).toEqual(overlayClientRect.top);
      });
    });

    describe('in rtl', () => {
      it('should use `right` when positioning an element at the start', () => {
        overlayRef.setDirection('rtl');

        const anchorClientRect = anchor.getBoundingClientRect();
        const overlayClientRect = overlayRef.overlayElement.getBoundingClientRect();
        expect(anchorClientRect.left).not.toEqual(overlayClientRect.left);
        expect(anchorClientRect.right).toEqual(overlayClientRect.right);
        expect(anchorClientRect.bottom).toEqual(overlayClientRect.top);
      });
    });
  });
});

/** Creates an anchor and its container. */
function createAnchorElements() {
  const anchorContainer = createAnchorContainerElement();
  const anchor = createAnchorElement();
  anchorContainer.appendChild(anchor);
  return {anchor, anchorContainer};
}

/** Creates an anchor. */
function createAnchorElement() {
  const element = document.createElement('div');
  element.className = 'anchor';
  return element;
}

/** Creates a container for an anchor. */
function createAnchorContainerElement() {
  const element = document.createElement('div');
  element.className = 'anchor-container';
  return element;
}

@Component({
  template: `
    <div class="overlay-content"></div>
  `,
})
class TestOverlayContent {}
