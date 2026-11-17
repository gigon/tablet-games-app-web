export const LANGUAGES = Object.freeze(['he', 'en']);
export const DEFAULT_LANGUAGE = 'he';

export const GENDERS = Object.freeze(['m', 'f']);
export const DEFAULT_GENDER = 'm';

export const SPEECH_LANGS = Object.freeze({
  he: 'he-IL',
  en: 'en-US',
});

const EN_COLORS = Object.freeze({
  red: 'red',
  blue: 'blue',
  yellow: 'yellow',
  green: 'green',
  orange: 'orange',
  purple: 'purple',
  pink: 'pink',
  white: 'white',
});

const HE_COLORS = Object.freeze({
  red: 'אדום',
  blue: 'כחול',
  yellow: 'צהוב',
  green: 'ירוק',
  orange: 'כתום',
  purple: 'סגול',
  pink: 'וורוד',
  white: 'לבן',
});

export const STRINGS = Object.freeze({
  en: Object.freeze({
    appTitle: 'Tablet games',
    level: 'Level {level}',
    welcomeTitle: 'Welcome',
    welcomeBack: 'Hello, {name}',
    nameQuestion: 'What is your name?',
    namePlaceholder: 'Your name',
    start: 'Start',
    starting: 'Starting…',
    hint: 'Keep Settings 1 and Settings 2 pressed together for two seconds.',
    yourName: 'Your name',
    save: 'Save',
    cancel: 'Cancel',
    menuTitle: 'Menu',
    settingsTitle: 'Settings',
    settings1: 'Settings 1',
    settings2: 'Settings 2',
    resume: 'Resume',
    changeName: 'Change name',
    exit: 'Exit',
    reset: 'Reset',
    resetConfirm: 'Tap again to reset',
    language: 'Language',
    gender: 'Gender',
    themes: 'Themes',
    name: 'Name',
    muteSpeech: 'Mute speech',
    recordPhrases: 'Record phrases',
    recordingsTitle: 'Record phrases',
    record: 'Record',
    stopRecording: 'Stop',
    playRecording: 'Play',
    deleteRecording: 'Delete',
    recordingRecorded: 'Recorded',
    recordingNotRecorded: 'Not recorded',
    recordingsClose: 'Close',
    recordingsDenied: 'Microphone access was denied.',
    recordingsUnsupported: 'Recording is not supported on this device.',
    recordingsFailed: 'Could not save the recording.',
    recordingsStorageError: 'Recordings are not available on this device.',
    chooseGame: 'Game',
    autoMix: 'Auto mix',
    chooseLevel: 'Level',
    auto: 'Auto',
    levelFor: 'Level for {type}',
    typeButtons: 'buttons',
    typeDrag: 'drag',
    typeCount: 'counting',
    musicStart: "Let's play together.",
    musicWhereLight: 'Where is the light?',
    musicEnd: 'That sounds lovely.',
    gardenStart: 'The garden is waiting.',
    gardenThirsty: 'Who is thirsty?',
    gardenColourPrompt: 'The {color} flower.',
    gardenBloom: 'It bloomed.',
    gardenShelf: 'Shelf',
    laundryPrompt: 'Put {item} in the machine.',
    putIn: 'Put',
    laundryShirt: 'the shirt',
    laundrySock: 'the sock',
    laundryTowel: 'the towel',
    laundryPhraseShirt: 'The shirt in the machine.',
    laundryPhraseSock: 'The sock in the machine.',
    laundryPhraseTowel: 'The towel in the machine.',
    showTextLabels: 'Show text labels',
    showStatusLine: 'Show status line',
    voice: 'Voice',
    voiceAuto: 'Default voice',
    speechRate: 'Speech rate',
    rateSlow: 'Slow',
    rateNormal: 'Normal',
    rateFast: 'Fast',
    statusLine: '{game} · Level {level} · {minutes} min',
    languageHebrew: 'Hebrew',
    languageEnglish: 'English',
    genderMale: 'Masculine',
    genderFemale: 'Feminine',
    friend: 'friend',
    helloPlay: 'Hello {name}. Let us play.',
    helloShort: 'Hello {name}.',
    pleaseTypeName: 'Please type your name.',
    praiseGood: 'Very nice.',
    praiseWellDone: 'Well done.',
    tryAgain: 'Once more.',
    press: 'Push',
    move: 'Move',
    touch: 'Touch',
    touchItem: '{touch} the {item}, {name}.',
    countThemePrompt: 'How many do you see, {name}?',
    moveItem: '{move} the {item} to the basket, {name}.',
    items: 'Items',
    colorButton: '{color} button',
    coins: 'Coins',
    basket: 'Basket',
    coinAria: 'Coin. Drag it to the basket.',
    colors: EN_COLORS,
  }),
  he: Object.freeze({
    appTitle: 'משחקים',
    level: 'שלב {level}',
    welcomeTitle: 'ברוכים הבאים',
    welcomeBack: 'שלום, {name}',
    nameQuestion: 'איך קוראים לך?',
    namePlaceholder: 'השם שלך',
    start: Object.freeze({ m: 'התחל', f: 'התחלי' }),
    starting: Object.freeze({ m: 'מתחיל…', f: 'מתחילה…' }),
    hint: 'יש להחזיק את הגדרות 1 והגדרות 2 יחד למשך שתי שניות.',
    yourName: 'השם שלך',
    save: Object.freeze({ m: 'שמור', f: 'שמרי' }),
    cancel: Object.freeze({ m: 'בטל', f: 'בטלי' }),
    menuTitle: 'תפריט',
    settingsTitle: 'הגדרות',
    settings1: 'הגדרות 1',
    settings2: 'הגדרות 2',
    resume: Object.freeze({ m: 'המשך', f: 'המשיכי' }),
    changeName: Object.freeze({ m: 'שנה שם', f: 'שני שם' }),
    exit: 'יציאה',
    reset: 'איפוס',
    resetConfirm: Object.freeze({ m: 'הקש שוב לאיפוס', f: 'הקישי שוב לאיפוס' }),
    language: 'שפה',
    gender: 'מין',
    themes: 'נושאים',
    name: 'שם',
    muteSpeech: 'השתקת דיבור',
    recordPhrases: 'הקלטת משפטים',
    recordingsTitle: 'הקלטת משפטים',
    record: Object.freeze({ m: 'הקלט', f: 'הקליטי' }),
    stopRecording: Object.freeze({ m: 'עצור', f: 'עצרי' }),
    playRecording: Object.freeze({ m: 'השמע', f: 'השמעי' }),
    deleteRecording: Object.freeze({ m: 'מחק', f: 'מחקי' }),
    recordingRecorded: 'הוקלט',
    recordingNotRecorded: 'לא הוקלט',
    recordingsClose: Object.freeze({ m: 'סגור', f: 'סגרי' }),
    recordingsDenied: 'הגישה למיקרופון נדחתה.',
    recordingsUnsupported: 'הקלטה אינה נתמכת במכשיר הזה.',
    recordingsFailed: 'לא הצלחנו לשמור את ההקלטה.',
    recordingsStorageError: 'ההקלטות אינן זמינות במכשיר הזה.',
    chooseGame: 'משחק',
    autoMix: 'מעבר אוטומטי',
    chooseLevel: 'שלב',
    auto: 'אוטומטי',
    levelFor: 'שלב עבור {type}',
    typeButtons: 'כפתורים',
    typeDrag: 'גרירה',
    typeCount: 'ספירה',
    musicStart: 'ננגן ביחד.',
    musicWhereLight: 'איפה האור?',
    musicEnd: 'זה נשמע יפה.',
    gardenStart: 'הגינה מחכה.',
    gardenThirsty: 'מי צמא?',
    gardenColourPrompt: 'הפרח ה{color}.',
    gardenBloom: 'הוא פרח.',
    gardenShelf: 'מדף',
    laundryPrompt: '{put} {item} במכונה.',
    putIn: Object.freeze({ m: 'שים', f: 'שמי' }),
    laundryShirt: 'את החולצה',
    laundrySock: 'את הגרב',
    laundryTowel: 'את המגבת',
    laundryPhraseShirt: 'החולצה למכונה.',
    laundryPhraseSock: 'הגרב למכונה.',
    laundryPhraseTowel: 'המגבת למכונה.',
    showTextLabels: 'הצגת תוויות טקסט',
    showStatusLine: 'הצגת שורת מצב',
    voice: 'קול',
    voiceAuto: 'קול ברירת מחדל',
    speechRate: 'קצב דיבור',
    rateSlow: 'אט',
    rateNormal: 'רגיל',
    rateFast: 'מהיר',
    statusLine: '{game} · שלב {level} · {minutes} דק׳',
    languageHebrew: 'עברית',
    languageEnglish: 'English',
    genderMale: 'לשון זכר',
    genderFemale: 'לשון נקבה',
    friend: Object.freeze({ m: 'חבר', f: 'חברה' }),
    helloPlay: 'שלום {name}. אפשר לשחק.',
    helloShort: 'שלום {name}.',
    pleaseTypeName: Object.freeze({ m: 'אנא הקלד את שמך.', f: 'אנא הקלדי את שמך.' }),
    praiseGood: 'יפה מאוד.',
    praiseWellDone: 'כל הכבוד.',
    tryAgain: 'עוד פעם.',
    press: Object.freeze({ m: 'לחץ', f: 'לחצי' }),
    move: Object.freeze({ m: 'העבר', f: 'העבירי' }),
    touch: Object.freeze({ m: 'גע', f: 'געי' }),
    touchItem: '{touch} ב{item}, {name}.',
    countThemePrompt: 'כמה יש כאן, {name}?',
    moveItem: '{move} את ה{item} לסל, {name}.',
    items: 'פריטים',
    colorButton: 'כפתור {color}',
    coins: 'מטבעות',
    basket: 'סל',
    coinAria: Object.freeze({ m: 'מטבע. גרור אותו לסל.', f: 'מטבע. גררי אותו לסל.' }),
    colors: HE_COLORS,
  }),
});

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeLanguage(value) {
  return LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

export function normalizeGender(value) {
  return GENDERS.includes(value) ? value : DEFAULT_GENDER;
}

function resolve(value, gender) {
  if (!isPlainObject(value)) return value;
  return value[normalizeGender(gender)] ?? value.m ?? '';
}

export function formatText(template, values = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) => {
    return values[key] === undefined ? match : String(values[key]);
  });
}

export function t(language, key, values = {}, gender = DEFAULT_GENDER) {
  const lang = normalizeLanguage(language);
  const value = STRINGS[lang][key] ?? STRINGS[DEFAULT_LANGUAGE][key] ?? '';
  return formatText(resolve(value, gender), values);
}

export function colorName(language, color) {
  const lang = normalizeLanguage(language);
  const names = STRINGS[lang].colors;
  if (typeof names[color] === 'string' && names[color].trim() !== '') return names[color];
  const fallback = STRINGS.en.colors[color];
  return typeof fallback === 'string' ? fallback : color;
}

export function gameText(game, language) {
  const lang = normalizeLanguage(language);
  const source = isPlainObject(game) ? game : {};
  const translations = isPlainObject(source.translations) ? source.translations : {};
  const local = isPlainObject(translations[lang]) ? translations[lang] : {};
  const localTitle = typeof local.title === 'string' ? local.title.trim() : '';
  const localPrompt = typeof local.prompt === 'string' ? local.prompt.trim() : '';
  return {
    title: localTitle || (typeof source.title === 'string' ? source.title : ''),
    prompt: localPrompt || (typeof source.prompt === 'string' ? source.prompt : ''),
    colors: isPlainObject(local.colors) ? local.colors : {},
  };
}

export function gameColorName(game, language, color) {
  const lang = normalizeLanguage(language);
  const localized = gameText(game, lang).colors[color];
  if (typeof localized === 'string' && localized.trim() !== '') return localized;
  return colorName(lang, color);
}

export function localizedName(entity, language) {
  const lang = normalizeLanguage(language);
  const source = isPlainObject(entity) ? entity : {};
  const names = isPlainObject(source.names) ? source.names : {};
  const local = typeof names[lang] === 'string' ? names[lang].trim() : '';
  if (local !== '') return local;
  const fallback = typeof names.en === 'string' ? names.en.trim() : '';
  if (fallback !== '') return fallback;
  return typeof source.id === 'string' ? source.id : '';
}

export function themeName(theme, language) {
  return localizedName(theme, language);
}

export function itemName(item, language) {
  return localizedName(item, language);
}

const LAUNDRY_ITEM_KEYS = Object.freeze({
  shirt: 'laundryShirt',
  sock: 'laundrySock',
  towel: 'laundryTowel',
});

const LAUNDRY_PHRASE_KEYS = Object.freeze({
  shirt: 'laundryPhraseShirt',
  sock: 'laundryPhraseSock',
  towel: 'laundryPhraseTowel',
});

export function laundryItemName(language, kind) {
  const key = LAUNDRY_ITEM_KEYS[kind] || LAUNDRY_ITEM_KEYS.shirt;
  return t(language, key);
}

export function formatLaundryPrompt(
  { language, gender = DEFAULT_GENDER, name = '', kind = 'shirt' } = {},
) {
  const lang = normalizeLanguage(language);
  const key = LAUNDRY_PHRASE_KEYS[kind] || LAUNDRY_PHRASE_KEYS.shirt;
  return t(lang, key, {}, gender);
}

export function formatPrompt(
  game,
  { language, gender = DEFAULT_GENDER, name = '', color, count } = {},
) {
  const lang = normalizeLanguage(language);
  const text = gameText(game, lang);
  return formatText(text.prompt, {
    name,
    color: color === undefined ? '' : gameColorName(game, lang, color),
    count: count === undefined ? '' : String(count),
    press: t(lang, 'press', {}, gender),
    move: t(lang, 'move', {}, gender),
  });
}
