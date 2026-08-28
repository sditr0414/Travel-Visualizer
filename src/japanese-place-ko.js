const JAPANESE_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff]/u;

const KNOWN_ROMAJI = Object.freeze({
  tokyo: '도쿄', kyoto: '교토', osaka: '오사카', chuo: '주오',
  shinjuku: '신주쿠', shibuya: '시부야', minato: '미나토', taito: '다이토',
  sumida: '스미다', shinagawa: '시나가와', meguro: '메구로', ota: '오타',
  setagaya: '세타가야', nakano: '나카노', suginami: '스기나미', toshima: '도시마',
  kita: '기타', arakawa: '아라카와', itabashi: '이타바시', nerima: '네리마',
  adachi: '아다치', katsushika: '가쓰시카', edogawa: '에도가와',
  namba: '난바', shinsaibashi: '신사이바시', dotonbori: '도톤보리', umeda: '우메다',
  tennoji: '덴노지', fukuoka: '후쿠오카', hakata: '하카타', sapporo: '삿포로',
  nagoya: '나고야', yokohama: '요코하마', kobe: '고베', nara: '나라',
  hiroshima: '히로시마', sendai: '센다이', kanazawa: '가나자와', kawasaki: '가와사키',
  okayama: '오카야마', kumamoto: '구마모토', kagoshima: '가고시마', naha: '나하',
  okinawa: '오키나와', hokkaido: '홋카이도', aomori: '아오모리', iwate: '이와테',
  miyagi: '미야기', akita: '아키타', yamagata: '야마가타', fukushima: '후쿠시마',
  ibaraki: '이바라키', tochigi: '도치기', gunma: '군마', saitama: '사이타마',
  chiba: '지바', kanagawa: '가나가와', niigata: '니가타', toyama: '도야마',
  ishikawa: '이시카와', fukui: '후쿠이', yamanashi: '야마나시', nagano: '나가노',
  gifu: '기후', shizuoka: '시즈오카', aichi: '아이치', mie: '미에', shiga: '시가',
  hyogo: '효고', wakayama: '와카야마', tottori: '돗토리', shimane: '시마네',
  yamaguchi: '야마구치', tokushima: '도쿠시마', kagawa: '가가와', ehime: '에히메',
  kochi: '고치', saga: '사가', nagasaki: '나가사키', oita: '오이타', miyazaki: '미야자키'
});

const MORA = Object.freeze({
  kya: '캬', kyu: '큐', kyo: '쿄', gya: '갸', gyu: '규', gyo: '교',
  sha: '샤', shu: '슈', sho: '쇼', ja: '자', ju: '주', jo: '조',
  cha: '차', chu: '추', cho: '초', nya: '냐', nyu: '뉴', nyo: '뇨',
  hya: '햐', hyu: '휴', hyo: '효', bya: '뱌', byu: '뷰', byo: '뵤',
  pya: '퍄', pyu: '퓨', pyo: '표', mya: '먀', myu: '뮤', myo: '묘',
  rya: '랴', ryu: '류', ryo: '료', shi: '시', chi: '치', tsu: '쓰', fu: '후',
  ka: '카', ki: '키', ku: '쿠', ke: '케', ko: '코',
  ga: '가', gi: '기', gu: '구', ge: '게', go: '고',
  sa: '사', su: '스', se: '세', so: '소',
  za: '자', ji: '지', zu: '즈', ze: '제', zo: '조',
  ta: '타', te: '테', to: '토', da: '다', de: '데', do: '도',
  na: '나', ni: '니', nu: '누', ne: '네', no: '노',
  ha: '하', hi: '히', he: '헤', ho: '호',
  ba: '바', bi: '비', bu: '부', be: '베', bo: '보',
  pa: '파', pi: '피', pu: '푸', pe: '페', po: '포',
  ma: '마', mi: '미', mu: '무', me: '메', mo: '모',
  ya: '야', yu: '유', yo: '요', ra: '라', ri: '리', ru: '루', re: '레', ro: '로',
  wa: '와', wo: '오', a: '아', i: '이', u: '우', e: '에', o: '오'
});

const TOKENS = Object.keys(MORA).sort((a, b) => b.length - a.length);

export function koreanJapanesePlaceName(properties) {
  if (!properties) return null;
  const korean = firstText(properties['name:ko'], properties.name_ko);
  if (korean) return korean;

  const native = firstText(properties['name:ja'], properties.name_ja,
    JAPANESE_SCRIPT.test(String(properties.name || '')) ? properties.name : null);
  if (!native) return null;

  const roman = firstText(
    properties['name:en'], properties.name_en,
    properties['name:latin'], properties.name_latin,
    properties.int_name, properties.name_int
  );
  if (!roman) return null;

  const suffix = japaneseAdministrativeSuffix(native);
  const baseRoman = stripRomanizedAdministrativeSuffix(roman, suffix);
  const hangul = romanizedJapaneseToHangul(baseRoman);
  if (!hangul) return null;
  return suffix && !hangul.endsWith(suffix) ? `${hangul}${suffix}` : hangul;
}

export function romanizedJapaneseToHangul(value) {
  const normalized = normalizeRomaji(value);
  if (!normalized) return null;

  return normalized
    .split(/([\s·・/]+)/u)
    .map(part => {
      if (!part || /^[\s·・/]+$/u.test(part)) return part.replace(/[・/]+/gu, ' · ');
      return transliterateWord(part);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/(?:\s*·\s*)+/g, ' · ')
    .trim() || null;
}

function transliterateWord(word) {
  if (!word) return '';
  if (KNOWN_ROMAJI[word]) return KNOWN_ROMAJI[word];
  if (/^[0-9]+(?:-[0-9]+)*$/u.test(word)) return word;

  let out = '';
  let index = 0;
  while (index < word.length) {
    const rest = word.slice(index);
    const current = word[index];
    const next = word[index + 1];

    if (current === "'") {
      index += 1;
      continue;
    }

    if (current === 'n' && (!next || next === "'" || !/[aeiouy]/.test(next))) {
      out = addFinalConsonant(out, 4, 'ㄴ');
      index += 1;
      continue;
    }

    if (current === 'm' && next && !/[aeiouy]/.test(next)) {
      out = addFinalConsonant(out, 16, 'ㅁ');
      index += 1;
      continue;
    }

    if (next && current === next && /[bcdfghjkpqrstvwxyz]/.test(current) && current !== 'n') {
      out = addFinalConsonant(out, 19, 'ㅅ');
      index += 1;
      continue;
    }

    const token = TOKENS.find(candidate => rest.startsWith(candidate));
    if (token) {
      out += MORA[token];
      index += token.length;
      continue;
    }

    if (current === '-') {
      index += 1;
      continue;
    }

    out += current;
    index += 1;
  }
  return out;
}

function normalizeRomaji(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ō/g, 'o')
    .replace(/ū/g, 'u')
    .replace(/ā/g, 'a')
    .replace(/ī/g, 'i')
    .replace(/ē/g, 'e')
    .replace(/[^a-z0-9'\-\s·・/]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function japaneseAdministrativeSuffix(native) {
  const text = String(native || '').trim();
  if (/丁目$/u.test(text)) return '초메';
  const match = text.match(/(都|道|府|県|市|区|郡|町|村)$/u);
  if (!match) return '';
  return ({ 都: '도', 道: '도', 府: '부', 県: '현', 市: '시', 区: '구', 郡: '군', 町: '정', 村: '촌' })[match[1]] || '';
}

function stripRomanizedAdministrativeSuffix(roman, koreanSuffix) {
  let text = String(roman || '').trim();
  if (!koreanSuffix) return text;
  text = text.replace(/\s+(?:city|ward|district|borough|prefecture|metropolis|province|town|village)$/i, '');
  text = text.replace(/-(?:shi|ku|gun|cho|chō|machi|mura|ken|fu|to|dō|do)$/i, '');
  return text.trim();
}

function addFinalConsonant(text, jongIndex, fallback) {
  if (!text) return fallback;
  const chars = [...text];
  const last = chars[chars.length - 1];
  const code = last.codePointAt(0);
  if (code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 0) {
    chars[chars.length - 1] = String.fromCodePoint(code + jongIndex);
    return chars.join('');
  }
  return `${text}${fallback}`;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && text.length <= 100) return text;
  }
  return null;
}
