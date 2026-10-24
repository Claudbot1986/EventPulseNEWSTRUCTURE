/**
 * Underrubrik är inte evenemangets namn — 2026-10-25.
 *
 * VARFÖR detta test finns: extraktorn hittar titlar med `[class*="title"]`.
 * CSS-väljaren matchar varje klass som innehåller strängen "title" — och
 * det gör även "subtitle", "subTitle", "hero-video__subtitle".
 *
 * På berwaldhallen.se:
 *
 *   <h3 class="Blurb__heading">
 *     <a href="…">
 *       Streetstar Dance School Challenge 2026
 *       <span class="Blurb__subtitle"> — Next Generation 14–16 år</span>
 *     </a>
 *   </h3>
 *
 * Underrubriken matchade `[class*="title"]` och låg först i
 * dokumentordningen — så 20 rader fick underrubriken som evenemangets
 * namn i stället för konsertens titel.
 *
 * BEVIS FÖR GENERAL (Generalization Protection Rule): samma klassmönster
 * på sju orelaterade domäner — berwaldhallen.se, berwaldhallen-tixly.se,
 * concerts50.com, nobelprizemuseum.se, modernamuseet.se, scalateatern.se
 * och svt.se. Det är HTML-kontraktet "klassnamn med 'subtitle' betyder
 * underrubrik", inte ett sitedomänproblem.
 *
 * Negativa kontroller: riktiga rubrik-klasser ("title", "event-title",
 * "post__title", "Blurb__heading") ska INTE påverkas, och en rubrik utan
 * klass ska alltid räknas.
 */

import { describe, it, expect } from 'vitest';
import {
  classTokenIsTitleish,
  elementHasTitleishClass,
  isHeadingTag,
  isTitleMarking,
} from './titleClassTokens';

describe('classTokenIsTitleish — rubrik-token', () => {
  it('accepterar vanliga rubrik-klasser', () => {
    expect(classTokenIsTitleish('title')).toBe(true);
    expect(classTokenIsTitleish('event-title')).toBe(true);
    expect(classTokenIsTitleish('post__title')).toBe(true);
    expect(classTokenIsTitleish('Blurb__heading')).toBe(true);
    expect(classTokenIsTitleish('card-title')).toBe(true);
  });

  it('avvisar underrubriker — även med stor T', () => {
    expect(classTokenIsTitleish('subtitle')).toBe(false);
    expect(classTokenIsTitleish('Blurb__subtitle')).toBe(false);
    expect(classTokenIsTitleish('subTitle')).toBe(false);
    expect(classTokenIsTitleish('hero-video__subtitle')).toBe(false);
    expect(classTokenIsTitleish('post-carousel__item-subtitle')).toBe(false);
    expect(classTokenIsTitleish('RelatedLinkTeaser__subTitle___yWnZC')).toBe(false);
  });

  it('avvisar klasser som inte handlar om rubriker alls', () => {
    expect(classTokenIsTitleish('Blurb')).toBe(false);
    expect(classTokenIsTitleish('price')).toBe(false);
  });
});

describe('elementHasTitleishClass', () => {
  it('element utan klass räknas som rubrik (de kan bara ha matchats av h1–h6)', () => {
    expect(elementHasTitleishClass({ attribs: {} })).toBe(true);
  });

  it('underrubrik utan rubrik-token räknas inte som rubrik', () => {
    expect(elementHasTitleishClass({ attribs: { class: 'Blurb__subtitle' } })).toBe(false);
  });

  it('klass med både rubrik- och underrubrik-token räknas som rubrik', () => {
    expect(elementHasTitleishClass({ attribs: { class: 'post-title post-subtitle' } })).toBe(true);
  });
});

describe('isHeadingTag / isTitleMarking', () => {
  it('h1–h6 är rubriker oavsett klass', () => {
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      expect(isHeadingTag({ tagName: tag })).toBe(true);
      expect(isTitleMarking({ tagName: tag, attribs: { class: 'text-2xl font-bold' } })).toBe(true);
    }
  });

  it('icke-rubrik-element måste ha en rubrik-token', () => {
    expect(isTitleMarking({ tagName: 'span', attribs: { class: 'Blurb__subtitle' } })).toBe(false);
    expect(isTitleMarking({ tagName: 'span', attribs: { class: 'Blurb__heading' } })).toBe(true);
    expect(isTitleMarking({ tagName: 'div', attribs: { class: 'post__title' } })).toBe(true);
  });
});
