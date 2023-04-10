/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {OverlayReference} from '../overlay-reference';
import {ElementRef, Inject} from '@angular/core';
import {DOCUMENT} from '@angular/common';
import {PositionStrategy} from './position-strategy';
import {Platform} from '@angular/cdk/platform';
import {ConnectionPositionPair, HorizontalConnectionPos} from './connected-position';

/** Possible values that can be set as the anchor of a AnchorPositioningStrategy. */
export type AnchorPositioningStrategyAnchor = ElementRef | Element | string;

interface AnchorPositionioningProperty {
  property: 'top' | 'bottom' | 'left' | 'right';
  anchorSide: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

// TODO(tbondwilkinson): Remove once anchorElement is recognized.
declare global {
  interface HTMLElement {
    anchorElement: Element | undefined;
  }
  interface CSSStyleDeclaration {
    positionFallback?: string;
  }
}

let positionFallbackId = 0;

export class AnchorPositioningStrategy implements PositionStrategy {
  /** The overlay to which this strategy is attached. */
  private _overlayRef: OverlayReference | null;

  /** The overlay pane element. */
  private _pane: HTMLElement;

  /** Whether the strategy has been disposed of already. */
  private _isDisposed: boolean;

  /** Ordered list of preferred positions, from most to least desirable. */
  private _preferredPositions: ConnectionPositionPair[] = [];

  /** The anchor element against which the overlay will be positioned. */
  private _anchor: AnchorPositioningStrategyAnchor;

  /** Whether the current positioning is stale and should be re-applied. */
  private _stalePositioning = true;

  /** The style root to add stylesheets to. */
  private _styleSheet?: CSSStyleSheet;

  constructor(
    anchor: AnchorPositioningStrategyAnchor,
    private _platform: Platform,
    @Inject(DOCUMENT) private readonly _document: Document,
  ) {
    this.withAnchor(anchor);
  }

  /** Attaches this position strategy to an overlay. */
  attach(overlayRef: OverlayReference) {
    if (
      this._overlayRef &&
      overlayRef !== this._overlayRef &&
      (typeof ngDevMode === 'undefined' || ngDevMode)
    ) {
      throw Error('This position strategy is already attached to an overlay');
    }

    this._overlayRef = overlayRef;
    this._pane = overlayRef.overlayElement;
    this._isDisposed = false;
  }

  /** Updates the position of the overlay element. */
  apply() {
    // We shouldn't do anything if the strategy was disposed or we're on the server.
    if (this._isDisposed || !this._platform.isBrowser) {
      return;
    }
    if (!this._stalePositioning) {
      return;
    }
    this._stalePositioning = false;

    this._resetOverlayElementStyles();

    let anchor: Element | undefined;
    let anchorName = '';

    if (typeof this._anchor === 'string') {
      anchorName = `${this._anchor} `;
    } else if (this._anchor instanceof ElementRef) {
      anchor = this._anchor.nativeElement;
    } else {
      anchor = this._anchor;
    }

    if (anchor) {
      this._pane.anchorElement = anchor;
    }

    const anchorPreferredPositionings = this._getAnchorPreferredPositionings();
    if (anchorPreferredPositionings.length === 1) {
      const style = this._pane.style;
      for (const {property, anchorSide} of anchorPreferredPositionings[0]) {
        style[property] = `anchor(--${anchorName}${anchorSide})`;
      }
      return;
    }
    const positionFallbackName = `--overlay-fallback-${positionFallbackId++}`;
    let positionFallback = `@position-fallback ${positionFallbackName} {\n`;

    for (const positioning of anchorPreferredPositionings) {
      positionFallback += '@try {\n';
      for (const {property, anchorSide} of positioning) {
        positionFallback += `${property}: anchor(--${anchorName} ${anchorSide});\n`;
      }
      positionFallback += '}\n';
    }
    positionFallback += '}';

    this._pane.style.positionFallback = positionFallbackName;
    this._addPositionFallbackStyle(positionFallback);
  }

  /** Called when the overlay is detached. */
  detach() {
    this._stalePositioning = true;
  }

  /** Cleans up any DOM modifications made by the position strategy, if necessary. */
  dispose() {
    if (this._isDisposed) {
      return;
    }

    this._resetOverlayElementStyles();
    this.detach();
    this._overlayRef = null;
    this._styleSheet?.replaceSync('');
    this._isDisposed = true;
  }

  /**
   * Adds new preferred positions.
   * @param positions List of positions options for this overlay.
   */
  withPositions(positions: ConnectionPositionPair[]): this {
    this._stalePositioning = true;
    this._preferredPositions = positions;

    return this;
  }

  /**
   * Sets the anchor, relative to which to position the overlay.
   * Using an element origin is useful for building components that need to be positioned
   * relatively to a trigger (e.g. dropdown menus or tooltips).
   * @param anchor Reference to the new origin.
   */
  withAnchor(anchor: AnchorPositioningStrategyAnchor): this {
    this._stalePositioning = true;
    this._anchor = anchor;

    return this;
  }

  private _getAnchorPreferredPositionings(): AnchorPositionioningProperty[][] {
    let overlayRect: DOMRect | undefined;
    const anchorPositioningProperties: AnchorPositionioningProperty[][] = [];
    for (const positionPair of this._preferredPositions) {
      const xProperty = this._logicalToPhysicalPosition(positionPair.overlayX);
      if (xProperty === 'center') {
        // TODO(tbondwilkinson): Support center.
        throw new Error('overlay center not supported by Anchor Positioning');
      }
      const yProperty = positionPair.overlayY;
      if (yProperty === 'center') {
        // TODO(twilkinson): Support center.
        throw new Error('overlay center not supported by Anchor Positioning');
      }
      anchorPositioningProperties.push([
        {
          property: xProperty,
          anchorSide: this._logicalToPhysicalPosition(positionPair.originX),
        },
        {
          property: yProperty,
          anchorSide: positionPair.originY,
        },
      ]);
    }
    return anchorPositioningProperties;
  }

  private _logicalToPhysicalPosition(
    position: HorizontalConnectionPos,
  ): 'left' | 'right' | 'center' {
    if (position === 'start') {
      return this._isRtl() ? 'right' : 'left';
    }
    if (position === 'end') {
      return this._isRtl() ? 'left' : 'right';
    }
    return position;
  }

  /** Resets the styles for the overlay pane so that a new positioning can be computed. */
  private _resetOverlayElementStyles() {
    this._pane.style.top = '';
    this._pane.style.bottom = '';
    this._pane.style.left = '';
    this._pane.style.right = '';
  }

  /** Whether the we're dealing with an RTL context */
  private _isRtl() {
    return this._overlayRef!.getDirection() === 'rtl';
  }

  private _addPositionFallbackStyle(style: string) {
    this._styleSheet = new CSSStyleSheet();
    this._styleSheet.replaceSync(style);
    this._document.adoptedStyleSheets = [...this._document.adoptedStyleSheets, this._styleSheet];
  }
}
