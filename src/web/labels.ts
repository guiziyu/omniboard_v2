// 显示用的名称(frontend-spec 0.4):来源显示名与缩写、tag 名、按界面语言格式化的时间。
import { tr, locale } from './i18n';
import { formatTime } from './format';
import { isTag, tagDefinitions } from '../shared/tags';
const sourceLabels: Record<string, string> = {
  cmc_web: 'CoinMarketCap',
  coingecko_web: 'CoinGecko',
  quant_pg: 'quant verification views',
  manual: 'Original note',
  attachment: 'Attachment',
  repository_code: 'Connector source code',
  repository_document: 'Connector dossier',
  official_website: 'Official website',
  user_report: 'Team or contact report',
  public_directory: 'Public directory',
  public_social: 'Public social profile',
  public_profile: 'Public profile',
  person_profile: 'Personal profile',
  x: 'X / Twitter',
  the_org: 'The Org',
  provider_agreement: 'Provider agreement',
  measurement: 'Measurement evidence',
};
export const sourceName = (source: string, url = '') =>
  ['public_profile', 'person_profile'].includes(source) &&
  /^https:\/\/(?:www\.)?linkedin\.com(?:\/|$)/i.test(url)
    ? 'LinkedIn'
    : tr(sourceLabels[source] || 'Reference');
export const shortSource = (source: string) =>
  source === 'cmc_web'
    ? 'CMC'
    : source === 'coingecko_web'
      ? 'CoinGecko'
      : source === 'quant_pg'
        ? 'quant'
        : tr('Manual');
export const tagName = (tag: string) =>
  isTag(tag)
    ? tr(tagDefinitions[tag].title)
    : tag.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
export const dateTime = (value: string | null | undefined) => formatTime(value, locale.value);
