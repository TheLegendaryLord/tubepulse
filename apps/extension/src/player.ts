import { mediaRoute, type MediaRoute, type PlaybackState } from './playback';
import type { Settings } from './settings';

const AD_SELECTOR = '.ad-showing, .ad-interrupting, ytd-ad-slot-renderer, ytd-shorts-video-ad-renderer';

export interface Player {
  video: HTMLVideoElement;
  player: Element;
  metadata: Element;
}

export function findPlayer(root: Document, route: MediaRoute): Player | undefined {
  let metadata: Element | null;
  let player: Element | null;
  if (route.kind === 'video') {
    metadata = root.querySelector(`ytd-watch-flexy[video-id="${route.videoId}"]:not([hidden])`);
    if (!metadata) return undefined;
    player = metadata.querySelector('#movie_player, .html5-video-player');
  } else if (route.kind === 'short') {
    metadata = root.querySelector('ytd-reel-video-renderer[is-active]');
    if (!metadata || metadata.matches('[hidden]') || metadata.querySelector(AD_SELECTOR))
      return undefined;
    const renderedId = metadata.getAttribute('video-id');
    if (renderedId && renderedId !== route.videoId) return undefined;
    player = metadata.querySelector('.html5-video-player');
  } else {
    metadata = root.querySelector('ytmusic-player-bar');
    player = root.querySelector('ytmusic-player #movie_player, ytmusic-player .html5-video-player');
    const href = metadata?.querySelector('.title a[href*="watch?"]')?.getAttribute('href');
    if (href) {
      let renderedRoute: MediaRoute | null;
      try {
        renderedRoute = mediaRoute(new URL(href, 'https://music.youtube.com').href);
      } catch {
        return undefined;
      }
      if (renderedRoute && renderedRoute.videoId !== route.videoId) return undefined;
    }
  }
  const video = player?.querySelector<HTMLVideoElement>('video.html5-main-video, video');
  if (!metadata || !player || !video) return undefined;
  return { player, video, metadata };
}

export function cleanText(value: string | null | undefined): string | undefined {
  const normalized = value
    ?.replace(/[\p{Cc}\s]+/gu, ' ')
    .trim()
    .slice(0, 128)
    .replace(/[\uD800-\uDBFF]$/u, '')
    .trimEnd();
  return normalized || undefined;
}

export function readMetadata(candidate: Player, kind: MediaRoute['kind'], settings: Settings) {
  const { metadata } = candidate;
  const selectors = {
    video: {
      title: 'h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, #title h1',
      channel: [
        'ytd-video-owner-renderer #channel-name #text',
        'ytd-video-owner-renderer #channel-name a',
        'ytd-video-owner-renderer #channel-name',
      ],
    },
    short: {
      title: 'yt-shorts-video-title-view-model, #overlay h2, #description yt-formatted-string',
      channel: [
        'yt-reel-channel-bar-view-model a[href^="/@"]',
        '#channel-info #channel-name #text',
        '#channel-name #text',
        '#channel-name',
      ],
    },
    music: { title: '.title', channel: ['.byline a', '.byline'] },
  }[kind];
  const title =
    settings.privacy || !settings.showTitle
      ? undefined
      : cleanText(metadata.querySelector(selectors.title)?.textContent);
  let channel: string | undefined;
  if (!settings.privacy && settings.showChannel) {
    for (const [index, selector] of selectors.channel.entries()) {
      const result = metadata.querySelector<HTMLElement>(selector);
      const channelText =
        index === selectors.channel.length - 1
          ? result?.innerText || result?.textContent
          : result?.textContent;
      channel = cleanText(kind === 'music' ? channelText?.split(' • ')[0] : channelText);
      if (channel) break;
    }
  }
  return { title, channel };
}

export interface VideoState {
  ended: boolean;
  played: boolean;
  paused: boolean;
  seeking: boolean;
  readyState: number;
  moving: boolean;
}

export function classifyPlayback(video: VideoState): PlaybackState | null {
  if (video.ended || !video.played) return null;
  if (video.paused) return 'paused';
  if (video.seeking || video.readyState < 3 || !video.moving) return 'buffering';
  return 'playing';
}

export function hasAd(candidate: Player): boolean {
  return candidate.player.matches(AD_SELECTOR) || Boolean(candidate.video.closest(AD_SELECTOR));
}
