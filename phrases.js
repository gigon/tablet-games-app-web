export const PHRASES = Object.freeze([
  Object.freeze({ id: '01', he: 'שלום. נתחיל.', en: "Hello. Let's begin." }),
  Object.freeze({ id: '02', he: 'כל הכבוד.', en: 'Well done.' }),
  Object.freeze({ id: '03', he: 'יפה מאוד.', en: 'Very nice.' }),
  Object.freeze({ id: '04', he: 'מצוין.', en: 'Excellent.' }),
  Object.freeze({ id: '05', he: 'עוד פעם.', en: 'Once more.' }),
  Object.freeze({ id: '06', he: 'כמעט. עוד פעם.', en: 'Almost. Once more.' }),
  Object.freeze({ id: '07', he: 'היה נעים. להתראות.', en: 'That was pleasant. Goodbye.' }),
  Object.freeze({ id: '10', he: 'החולצה למכונה.', en: 'The shirt in the machine.' }),
  Object.freeze({ id: '11', he: 'הגרב למכונה.', en: 'The sock in the machine.' }),
  Object.freeze({ id: '12', he: 'המגבת למכונה.', en: 'The towel in the machine.' }),
  Object.freeze({ id: '13', he: 'הכביסה מוכנה.', en: 'The laundry is ready.' }),
  Object.freeze({ id: '14', he: 'איפה המכונה?', en: 'Where is the machine?' }),
  Object.freeze({ id: '20', he: 'ננגן ביחד.', en: "Let's play together." }),
  Object.freeze({ id: '21', he: 'איפה האור?', en: 'Where is the light?' }),
  Object.freeze({ id: '22', he: 'זה נשמע יפה.', en: 'That sounds lovely.' }),
  Object.freeze({ id: '23', he: 'עוד שיר?', en: 'Another song?' }),
  Object.freeze({ id: '24', he: 'האדום.', en: 'The red one.' }),
  Object.freeze({ id: '25', he: 'הכחול.', en: 'The blue one.' }),
  Object.freeze({ id: '26', he: 'הירוק.', en: 'The green one.' }),
  Object.freeze({ id: '27', he: 'הצהוב.', en: 'The yellow one.' }),
  Object.freeze({ id: '40', he: 'הגינה מחכה.', en: 'The garden is waiting.' }),
  Object.freeze({ id: '41', he: 'מי צמא?', en: 'Who is thirsty?' }),
  Object.freeze({ id: '42', he: 'הפרח הצהוב.', en: 'The yellow flower.' }),
  Object.freeze({ id: '43', he: 'הפרח האדום.', en: 'The red flower.' }),
  Object.freeze({ id: '44', he: 'הפרח הוורוד.', en: 'The pink flower.' }),
  Object.freeze({ id: '45', he: 'הפרח הלבן.', en: 'The white flower.' }),
  Object.freeze({ id: '46', he: 'הוא פרח.', en: 'It bloomed.' }),
  Object.freeze({ id: '50', he: 'בועות.', en: 'Bubbles.' }),
  Object.freeze({ id: '51', he: 'הכול פוצץ.', en: 'All popped.' }),
  Object.freeze({ id: '52', he: 'עוד דף?', en: 'Another sheet?' }),
  Object.freeze({ id: '120', he: 'שמי לילה.', en: 'Night sky.' }),
  Object.freeze({ id: '121', he: 'סירה.', en: 'A boat.' }),
  Object.freeze({ id: '122', he: 'לב.', en: 'A heart.' }),
  Object.freeze({ id: '123', he: 'יונה.', en: 'A dove.' }),
  Object.freeze({ id: '124', he: 'עוד כוכב?', en: 'Another star?' }),
  Object.freeze({ id: '130', he: 'כדורים.', en: 'Balls.' }),
  Object.freeze({ id: '131', he: 'הרבה.', en: 'So many.' }),
  Object.freeze({ id: '132', he: 'הצנצנת מלאה.', en: 'The jar is full.' }),
]);

function normalise(text) {
  return text.replace(/\s+/g, ' ').trim();
}

const PHRASE_IDS_BY_TEXT = {
  he: new Map(PHRASES.map((phrase) => [normalise(phrase.he), phrase.id])),
  en: new Map(PHRASES.map((phrase) => [normalise(phrase.en), phrase.id])),
};

export function phraseIdForText(language, text) {
  if (typeof text !== 'string') return null;

  const lookup = PHRASE_IDS_BY_TEXT[language];
  if (!lookup) return null;

  return lookup.get(normalise(text)) ?? null;
}

const PHRASES_BY_ID = new Map(PHRASES.map((phrase) => [phrase.id, phrase]));

// The text of one catalog phrase in a language, or '' for an unknown id.
export function phraseText(id, language) {
  const phrase = PHRASES_BY_ID.get(id);
  if (!phrase) return '';
  return language === 'en' ? phrase.en : phrase.he;
}

export function createRecordingStore(backend) {
  if (!backend) throw new TypeError('A recording backend is required.');

  return {
    save(id, blob) {
      return backend.save(id, blob);
    },
    get(id) {
      return backend.get(id);
    },
    remove(id) {
      return backend.remove(id);
    },
    ids() {
      return backend.ids();
    },
  };
}

export function createMemoryBackend() {
  const recordings = new Map();

  return {
    async save(id, blob) {
      recordings.set(id, blob);
    },
    async get(id) {
      return recordings.has(id) ? recordings.get(id) : null;
    },
    async remove(id) {
      recordings.delete(id);
    },
    async ids() {
      return [...recordings.keys()];
    },
  };
}

const DB_NAME = 'tablet-games-voice';
const STORE_NAME = 'recordings';

export function createIndexedDbBackend(indexedDB) {
  if (!indexedDB) throw new TypeError('An IndexedDB implementation is required.');

  let databasePromise = null;

  function openDatabase() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open recordings.'));
      });
    }
    return databasePromise;
  }

  function runTransaction(mode, action) {
    return openDatabase().then((database) => new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const result = action(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('Recording storage failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Recording storage failed.'));
    }));
  }

  return {
    save(id, blob) {
      return runTransaction('readwrite', (store) => {
        store.put(blob, id);
      });
    },
    get(id) {
      return openDatabase().then((database) => new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result === undefined ? null : request.result);
        request.onerror = () => reject(request.error || new Error('Could not read recording.'));
      }));
    },
    remove(id) {
      return runTransaction('readwrite', (store) => {
        store.delete(id);
      });
    },
    ids() {
      return openDatabase().then((database) => new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).getAllKeys();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error('Could not list recordings.'));
      }));
    },
  };
}
