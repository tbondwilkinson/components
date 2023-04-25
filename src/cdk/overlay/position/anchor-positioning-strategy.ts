/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {OverlayReference} from '../overlay-reference';
import {ElementRef} from '@angular/core';
import {PositionStrategy} from './position-strategy';
import {Platform} from '@angular/cdk/platform';
import {Subject} from 'rxjs';
import {
  ConnectedOverlayPositionChange,
  ConnectionPositionPair,
  ScrollingVisibility,
  validateConnectionPositionPairs,
} from './connected-position';
import {OverlayContainer} from '../overlay-container';
import {
  ConnectedPosition,
  FlexibleConnectedPositionStrategyOrigin,
} from './flexible-connected-position-strategy';
import {CdkScrollable} from '../scroll';
import {isElementScrolledOutsideView, isElementClippedByScrolling} from './scroll-clip';

/** Class to be added to the overlay bounding box. */
const BOUNDING_BOX_CLASS = 'cdk-overlay-connected-position-bounding-box';

/** Equivalent of `ClientRect` without some of the properties we don't care about. */
type Dimensions = Omit<ClientRect, 'x' | 'y' | 'toJSON'>;

let positionFallbackId = 0;

interface AnchorPosition {
  top?: string;
  bottom?: string;
  centerBlock: boolean;
  left?: string;
  right?: string;
  centerInline: boolean;
}

// TODO(tbondwilkinson): Remove once anchorElement is recognized.
declare global {
  interface HTMLElement {
    anchorElement: Element | undefined;
  }

  interface CSSStyleDeclaration {
    anchorName?: string;
    anchorDefault?: string;
    positionFallback?: string;
  }
}

export class AnchorPositioningStrategy implements PositionStrategy {
  /** The overlay to which this strategy is attached. */
  private _overlayReference?: OverlayReference;

  /** The overlay pane element. */
  private _overlayElement?: HTMLElement;

  /**
   * Parent element for the overlay panel used to constrain the overlay panel's size to fit
   * within the viewport.
   */
  private _hostElement?: HTMLElement;

  /** The anchor element against which the overlay will be positioned. */
  private _origin: FlexibleConnectedPositionStrategyOrigin;

  /** Subject that emits whenever the position changes. */
  private readonly _positionChanges = new Subject<ConnectedOverlayPositionChange>();

  /** Whether the strategy has been disposed of already. */
  private _isDisposed = false;

  /** The Scrollable containers used to check scrollable view properties on position change. */
  private _scrollables: CdkScrollable[] = [];

  /** Ordered list of preferred positions, from most to least desirable. */
  private _preferredPositions: ConnectionPositionPair[] = [];

  /** Amount of space that must be maintained between the overlay and the edge of the viewport. */
  private _viewportMargin = 0;

  /** Whether the overlay's width and height can be constrained to fit within the viewport. */
  private _hasFlexibleDimensions = true;

  /** Whether the overlay can grow via flexible width/height after the initial open. */
  private _growAfterOpen = false;

  /** Whether the overlay can be pushed on-screen on the initial open. */
  private _canPush = true;

  /** Whether the overlay position is locked. */
  private _positionLocked = false;

  /** Default offset for the overlay along the x axis. */
  private _offsetX = 0;

  /** Default offset for the overlay along the y axis. */
  private _offsetY = 0;

  constructor(
    origin: FlexibleConnectedPositionStrategyOrigin,
    private _document: Document,
    private _platform: Platform,
    private _overlayContainer: OverlayContainer,
  ) {
    this.setOrigin(origin);
  }

  /** Attaches this position strategy to an overlay. */
  attach(overlayRef: OverlayReference): void {
    if (
      this._overlayReference &&
      overlayRef !== this._overlayReference &&
      (typeof ngDevMode === 'undefined' || ngDevMode)
    ) {
      throw Error('This position strategy is already attached to an overlay');
    }

    this._validatePositions();

    this._overlayReference = overlayRef;
    this._hostElement = overlayRef.hostElement;
    this._overlayElement = overlayRef.overlayElement;
    this._isDisposed = false;

    this._hostElement.classList.add(BOUNDING_BOX_CLASS);
  }

  /** Updates the position of the overlay element. */
  apply() {
    // We shouldn't do anything if the strategy was disposed or we're on the server.
    if (this._isDisposed || !this._platform.isBrowser) {
      return;
    }

    this._resetOverlayElementStyles();
    this._resetHostElementStyles(/* insetZero= */ true);

    const anchor =
      this._origin instanceof ElementRef
        ? (this._origin.nativeElement as Element)
        : (this._origin as Element);
    this._overlayElement!.anchorElement = anchor;

    this._applyAnchorPositioning();
    this._observePosition();
  }

  /** Called when the overlay is detached. */
  detach() {
    // TODO(twilkinson): Commit current position on detach?
  }

  /** Cleans up any DOM modifications made by the position strategy, if necessary. */
  dispose() {
    if (this._isDisposed) {
      return;
    }

    this._resetHostElementStyles();
    this._hostElement?.classList.remove(BOUNDING_BOX_CLASS);
    this._resetOverlayElementStyles();

    this._positionChanges.complete();

    delete this._overlayReference;
    delete this._hostElement;
    delete this._overlayElement;
    this._isDisposed = true;
  }

  reapplyLastPosition(): void {
    throw new Error('Unimplemented. With anchor positioning the browser does positioning.');
  }

  /**
   * Sets the anchor, relative to which to position the overlay.
   * Using an element origin is useful for building components that need to be positioned
   * relatively to a trigger (e.g. dropdown menus or tooltips).
   * @param anchor Reference to the new origin.
   */
  setOrigin(origin: FlexibleConnectedPositionStrategyOrigin): this {
    if (!(origin instanceof Element || origin instanceof ElementRef)) {
      throw new Error('AnchorPositioningStrategy only works with an Element or ElementRef');
    }
    this._origin = origin;

    return this;
  }

  /**
   * Sets the list of Scrollable containers that host the origin element so that
   * on reposition we can evaluate if it or the overlay has been clipped or outside view. Every
   * Scrollable must be an ancestor element of the strategy's origin element.
   */
  withScrollableContainers(scrollables: CdkScrollable[]): this {
    this._scrollables = scrollables;
    return this;
  }

  /**
   * Adds new preferred positions.
   * @param positions List of positions options for this overlay.
   */
  withPositions(positions: ConnectedPosition[]): this {
    this._preferredPositions = positions;

    this._validatePositions();

    return this;
  }

  /**
   * Sets a minimum distance the overlay may be positioned to the edge of the viewport.
   * @param margin Required margin between the overlay and the viewport edge in pixels.
   */
  withViewportMargin(margin: number): this {
    this._viewportMargin = margin;
    return this;
  }

  /** Sets whether the overlay's width and height can be constrained to fit within the viewport. */
  withFlexibleDimensions(flexibleDimensions = true): this {
    this._hasFlexibleDimensions = flexibleDimensions;
    return this;
  }

  /** Sets whether the overlay can grow after the initial open via flexible width/height. */
  withGrowAfterOpen(growAfterOpen = true): this {
    // TODO(twilkinson): This doesn't apply for anchor positioning since we don't measure the
    // bounding box or overlay.
    this._growAfterOpen = growAfterOpen;
    return this;
  }

  /** Sets whether the overlay can be pushed on-screen if none of the provided positions fit. */
  withPush(canPush = true): this {
    // TODO(twilkinson): There's no easy way to push overlays into the viewport with
    // fallback positioning.
    this._canPush = canPush;
    return this;
  }

  /**
   * Sets whether the overlay's position should be locked in after it is positioned
   * initially. When an overlay is locked in, it won't attempt to reposition itself
   * when the position is re-applied (e.g. when the user scrolls away).
   * @param isLocked Whether the overlay should locked in.
   */
  withLockedPosition(isLocked = true): this {
    // TODO(twilkinson): Implement this along with detach behavior.
    this._positionLocked = isLocked;
    return this;
  }

  /**
   * Sets the default offset for the overlay's connection point on the x-axis.
   * @param offset New offset in the X axis.
   */
  withDefaultOffsetX(offset: number): this {
    this._offsetX = offset;
    return this;
  }

  /**
   * Sets the default offset for the overlay's connection point on the y-axis.
   * @param offset New offset in the Y axis.
   */
  withDefaultOffsetY(offset: number): this {
    this._offsetY = offset;
    return this;
  }

  private _applyAnchorPositioning() {
    // set transform origin?
    // set max width and height.
    this._setOverlayElementStyles();
    this._setHostElementStyles();
    const positionFallbackIdent = `--overlay-position-fallback-${positionFallbackId++}`;
    const positionFallbackCss = this._getPositionTryCss(positionFallbackIdent);
  }

  private _setOverlayElementStyles() {
    // Fixed position is necessary to position most anchored elements that reside within overlays.
    this._overlayElement!.style.position = 'fixed';
    if (this._hasFlexibleDimensions) {
      const config = this._overlayReference!.getConfig();
      if (config.minHeight) {
        this._overlayElement!.style.minHeight = config.minHeight;
      }
      if (config.minWidth) {
        this._overlayElement!.style.minWidth = config.minWidth;
      }
    }
  }

  private _setHostElementStyles() {
    if (this._viewportMargin) {
      this._hostElement!.style.margin = `${this._viewportMargin}px`;
    }
  }

  /** Validates that the current position match the expected values. */
  private _validatePositions(): void {
    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      if (!this._preferredPositions.length) {
        throw Error('AnchorPositioningStrategy: At least one position is required.');
      }
      this._preferredPositions.forEach(pair => {
        if (pair.panelClass) {
          throw new Error('AnchorPositioningStrategy: panelClass not supported.');
        }
      });

      validateConnectionPositionPairs(this._preferredPositions);
    }
  }

  private _getPositionTryCss(positionFallbackIdent: string) {
    let positionFallbackCss = `@position ${positionFallbackIdent} { `;
    for (const position of this._preferredPositions) {
      let tryCss = `@try { `;
      const anchorPosition = this._getAnchorPosition(position);
      if (anchorPosition.top) {
        tryCss += `top: ${anchorPosition.top}; `;
      }
      if (anchorPosition.bottom) {
        tryCss += `bottom: ${anchorPosition.bottom}; `;
      }
      if (anchorPosition.centerBlock) {
        tryCss += `align-items: center; `;
      } else {
        const alignItems = position.overlayX === 'end' ? 'flex-end' : 'flex-start';
        tryCss += `align-items: ${alignItems}`.
      }
      if (anchorPosition.left) {
        tryCss += `left: ${anchorPosition.left}; `;
      }
      if (anchorPosition.right) {
        tryCss += `right: ${anchorPosition.right}; `;
      }
      if (anchorPosition.centerInline) {
        tryCss += `justify-content: center; `;
      } else {
        const justifyContent = position.overlayY === 'bottom' ? 'flex-end' : 'flex-start';
        tryCss += `justify-content: ${justifyContent}`;
      }
      tryCss += `} `;
      positionFallbackCss += tryCss;
    }
    positionFallbackCss += `}`;
    return positionFallbackCss;
  }

  private _getAnchorPosition(position: ConnectedPosition): AnchorPosition {
    const anchorPosition: Partial<AnchorPosition> = {};
    const anchorY = `anchor(${position.originY})`;
    const anchorX = `anchor(${position.originX})`;
    if (position.overlayY === 'center') {
      anchorPosition.top = this._getAnchorCenterCalc(anchorY);
      anchorPosition.bottom = this._getAnchorCenterCalc(anchorY);
      anchorPosition.centerBlock = true;
    } else if (position.overlayY === 'top') {
      anchorPosition.top = anchorY;
    } else {
      anchorPosition.bottom = anchorY;
    }

    if (position.overlayX === 'center') {
      anchorPosition.top = this._getAnchorCenterCalc(anchorX);
      anchorPosition.bottom = this._getAnchorCenterCalc(anchorX);
      anchorPosition.centerInline = true;
    } else if (position.overlayX === 'start' || !this._isRtl()) {
      anchorPosition.left = anchorX;
    } else {
      anchorPosition.right = anchorX;
    }
    return anchorPosition as AnchorPosition;
  }

  private _getAnchorCenterCalc(anchorInset: string) {
    return `calc(${anchorInset} - min(${anchorInset} - 0%, 100% - ${anchorInset}))`;
  }

  /** Resets the styles for the bounding box so that a new positioning can be computed. */
  private _resetHostElementStyles(insetZero = false) {
    if (!this._hostElement) {
      return;
    }
    const insetLength = insetZero ? '0' : '';
    extendStyles(this._hostElement!.style, {
      top: insetLength,
      left: insetLength,
      right: insetLength,
      bottom: insetLength,
      height: '',
      width: '',
      alignItems: '',
      justifyContent: '',
      margin: '',
    } as CSSStyleDeclaration);
  }

  /** Resets the styles for the overlay pane so that a new positioning can be computed. */
  private _resetOverlayElementStyles() {
    if (!this._overlayElement) {
      return;
    }
    extendStyles(this._overlayElement.style, {
      top: '',
      left: '',
      bottom: '',
      right: '',
      position: '',
      transform: '',
      minHeight: '',
      minWidth: '',
    } as CSSStyleDeclaration);
  }

  /**
   * After a request to "change" the position of the overlay, emits a position change event.
   * @param position The position preference
   * @param originPoint The point on the origin element where the overlay is connected.
   */
  private _observePosition() {
    if (this._positionChanges.observers.length) {
      const position = this._getPosition();
      const scrollableViewProperties = this._getScrollVisibility();
      const changeEvent = new ConnectedOverlayPositionChange(position, scrollableViewProperties);
      this._positionChanges.next(changeEvent);
    }
  }

  private _getPosition(): ConnectedPosition {
    // TODO(twilkinson): Finish.
    return {} as ConnectedPosition;
  }

  /** Whether the we're dealing with an RTL context */
  private _isRtl() {
    return this._overlayReference!.getDirection() === 'rtl';
  }

  /**
   * Gets the view properties of the trigger and overlay, including whether they are clipped
   * or completely outside the view of any of the strategy's scrollables.
   */
  private _getScrollVisibility(): ScrollingVisibility {
    // Note: needs fresh rects since the position could've changed.
    const originBounds = this._getOriginRect();
    const overlayBounds = this._overlayElement!.getBoundingClientRect();

    // TODO(jelbourn): instead of needing all of the client rects for these scrolling containers
    // every time, we should be able to use the scrollTop of the containers if the size of those
    // containers hasn't changed.
    const scrollContainerBounds = this._scrollables.map(scrollable => {
      return scrollable.getElementRef().nativeElement.getBoundingClientRect();
    });

    return {
      isOriginClipped: isElementClippedByScrolling(originBounds, scrollContainerBounds),
      isOriginOutsideView: isElementScrolledOutsideView(originBounds, scrollContainerBounds),
      isOverlayClipped: isElementClippedByScrolling(overlayBounds, scrollContainerBounds),
      isOverlayOutsideView: isElementScrolledOutsideView(overlayBounds, scrollContainerBounds),
    };
  }

  /** Returns the ClientRect of the current origin. */
  private _getOriginRect(): Dimensions {
    const origin = this._origin;

    if (origin instanceof ElementRef) {
      return origin.nativeElement.getBoundingClientRect();
    }

    // Check for Element so SVG elements are also supported.
    if (origin instanceof Element) {
      return origin.getBoundingClientRect();
    }

    const width = origin.width || 0;
    const height = origin.height || 0;

    // If the origin is a point, return a client rect as if it was a 0x0 element at the point.
    return {
      top: origin.y,
      bottom: origin.y + height,
      left: origin.x,
      right: origin.x + width,
      height,
      width,
    };
  }
}

/** Shallow-extends a stylesheet object with another stylesheet object. */
function extendStyles(
  destination: CSSStyleDeclaration,
  source: CSSStyleDeclaration,
): CSSStyleDeclaration {
  for (let key in source) {
    if (source.hasOwnProperty(key)) {
      destination[key] = source[key];
    }
  }

  return destination;
}
