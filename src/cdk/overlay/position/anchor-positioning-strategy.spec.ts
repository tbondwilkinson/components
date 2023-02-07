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

// Default width and height of the overlay and origin panels throughout these tests.
const DEFAULT_HEIGHT = 30;
const DEFAULT_WIDTH = 60;

describe('AnchorPositioningStrategy', () => {
  let overlay: Overlay;
  let overlayContainer: OverlayContainer;
  let platform: Platform;
  let zone: MockNgZone;
  let overlayRef: OverlayRef;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OverlayModule, PortalModule],
      declarations: [TestOverlay],
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

  function attachOverlay(config: OverlayConfig) {
    overlayRef = overlay.create(config);
    overlayRef.attach(new ComponentPortal(TestOverlay));
    zone.simulateZoneExit();
  }

  fdescribe('positioning', () => {
    let anchor: HTMLElement;
    let positionStrategy: AnchorPositioningStrategy;

    beforeEach(() => {
      anchor = createPositionedBlockElement();
      document.body.appendChild(anchor);
      positionStrategy = new AnchorPositioningStrategy(anchor, platform);
    });

    afterEach(() => {
      anchor.remove();
    });

    describe('in ltr', () => {
      it('should use `left` when positioning an element at the start', () => {
        positionStrategy.withPositions([
          {
            originX: 'start',
            originY: 'top',
            overlayX: 'start',
            overlayY: 'top',
          },
        ]);

        attachOverlay({positionStrategy});

        expect(overlayRef.hostElement.style.left).toBeTruthy();
        expect(overlayRef.hostElement.style.right).toBeFalsy();
      });
    });
  });
});

/** Creates an absolutely positioned, display: block element with a default size. */
function createPositionedBlockElement() {
  const element = createBlockElement();
  element.style.position = 'absolute';
  return element;
}

/** Creates a block element with a default size. */
function createBlockElement(tagName = 'div', namespace?: string) {
  let element;

  if (namespace) {
    element = document.createElementNS(namespace, tagName) as HTMLElement;
  } else {
    element = document.createElement(tagName);
  }

  element.style.width = `${DEFAULT_WIDTH}px`;
  element.style.height = `${DEFAULT_HEIGHT}px`;
  element.style.backgroundColor = 'rebeccapurple';
  element.style.zIndex = '100';
  return element;
}

/** Creates an overflow container with a set height and width with margin. */
function createOverflowContainerElement() {
  const element = document.createElement('div');
  element.style.position = 'relative';
  element.style.overflow = 'auto';
  element.style.height = '300px';
  element.style.width = '300px';
  element.style.margin = '100px';
  return element;
}

@Component({
  template: `
    <div
      style="width: ${DEFAULT_WIDTH}px; height: ${DEFAULT_HEIGHT}px;"></div>
  `,
})
class TestOverlay {}
