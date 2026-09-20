/** Traditional public-domain / freely recited rite texts for field use. */

export type TraditionId =
  | "christian"
  | "orthodox"
  | "jewish"
  | "islamic"
  | "buddhist"
  | "hindu";

export type Prayer = {
  id: string;
  name: string;
  /** Short instrument label for the log strip. */
  shortName: string;
  /** Language hint for Web Speech API (BCP-47). */
  lang: string;
  /** Full text shown on screen and spoken. */
  text: string;
};

export type Tradition = {
  id: TraditionId;
  label: string;
  prayers: Prayer[];
};

export const TRADITIONS: Tradition[] = [
  {
    id: "christian",
    label: "Christian",
    prayers: [
      {
        id: "lords-prayer",
        name: "The Lord's Prayer",
        shortName: "Lord's Prayer",
        lang: "en-US",
        text: `Our Father who art in heaven, hallowed be thy name.
Thy kingdom come. Thy will be done on earth as it is in heaven.
Give us this day our daily bread, and forgive us our trespasses, as we forgive those who trespass against us.
And lead us not into temptation, but deliver us from evil.
Amen.`,
      },
      {
        id: "psalm-91",
        name: "Psalm 91",
        shortName: "Psalm 91",
        lang: "en-US",
        text: `He that dwelleth in the secret place of the most High shall abide under the shadow of the Almighty.
I will say of the Lord, He is my refuge and my fortress: my God; in him will I trust.
Surely he shall deliver thee from the snare of the fowler, and from the noisome pestilence.
He shall cover thee with his feathers, and under his wings shalt thou trust: his truth shall be thy shield and buckler.
Thou shalt not be afraid for the terror by night; nor for the arrow that flieth by day;
Nor for the pestilence that walketh in darkness; nor for the destruction that wasteth at noonday.
A thousand shall fall at thy side, and ten thousand at thy right hand; but it shall not come nigh thee.
Only with thine eyes shalt thou behold and see the reward of the wicked.
Because thou hast made the Lord, which is my refuge, even the most High, thy habitation;
There shall no evil befall thee, neither shall any plague come nigh thy dwelling.
For he shall give his angels charge over thee, to keep thee in all thy ways.
They shall bear thee up in their hands, lest thou dash thy foot against a stone.
Thou shalt tread upon the lion and adder: the young lion and the dragon shalt thou trample under feet.
Because he hath set his love upon me, therefore will I deliver him: I will set him on high, because he hath known my name.
He shall call upon me, and I will answer him: I will be with him in trouble; I will deliver him, and honour him.
With long life will I satisfy him, and shew him my salvation.`,
      },
      {
        id: "st-michael",
        name: "Prayer to Saint Michael",
        shortName: "St. Michael",
        lang: "en-US",
        text: `Saint Michael the Archangel, defend us in battle.
Be our protection against the wickedness and snares of the devil.
May God rebuke him, we humbly pray;
and do thou, O Prince of the heavenly host, by the power of God, cast into hell Satan and all the evil spirits who prowl about the world seeking the ruin of souls.
Amen.`,
      },
    ],
  },
  {
    id: "orthodox",
    label: "Orthodox",
    prayers: [
      {
        id: "jesus-prayer",
        name: "Jesus Prayer",
        shortName: "Jesus Prayer",
        lang: "en-US",
        text: `Lord Jesus Christ, Son of God, have mercy on me, a sinner.`,
      },
      {
        id: "trisagion",
        name: "Trisagion",
        shortName: "Trisagion",
        lang: "en-US",
        text: `Holy God, Holy Mighty, Holy Immortal, have mercy on us.
Holy God, Holy Mighty, Holy Immortal, have mercy on us.
Holy God, Holy Mighty, Holy Immortal, have mercy on us.
Glory to the Father, and to the Son, and to the Holy Spirit, both now and ever and unto ages of ages. Amen.
O Most Holy Trinity, have mercy on us. Lord, cleanse us from our sins. Master, pardon our iniquities. Holy One, visit and heal our infirmities for Thy name's sake.
Lord, have mercy. Lord, have mercy. Lord, have mercy.`,
      },
    ],
  },
  {
    id: "jewish",
    label: "Jewish",
    prayers: [
      {
        id: "shema",
        name: "Shema",
        shortName: "Shema",
        lang: "en-US",
        text: `Hear, O Israel: The Lord our God, the Lord is One.
And thou shalt love the Lord thy God with all thine heart, and with all thy soul, and with all thy might.
And these words, which I command thee this day, shall be upon thine heart:
And thou shalt teach them diligently unto thy children, and shalt talk of them when thou sittest in thine house, and when thou walkest by the way, and when thou liest down, and when thou risest up.
And thou shalt bind them for a sign upon thine hand, and they shall be for frontlets between thine eyes.
And thou shalt write them upon the door-posts of thy house, and upon thy gates.`,
      },
    ],
  },
  {
    id: "islamic",
    label: "Islamic",
    prayers: [
      {
        id: "ayat-al-kursi",
        name: "Ayat al-Kursi",
        shortName: "Ayat al-Kursi",
        lang: "en-US",
        text: `Allah! There is no God save Him, the Alive, the Eternal.
Neither slumber nor sleep overtaketh Him.
Unto Him belongeth whatsoever is in the heavens and whatsoever is in the earth.
Who is he that intercedeth with Him save by His leave?
He knoweth that which is in front of them and that which is behind them, while they encompass nothing of His knowledge save what He will.
His throne includeth the heavens and the earth, and He is never weary of preserving them.
He is the Sublime, the Tremendous.`,
      },
      {
        id: "al-falaq",
        name: "Surah Al-Falaq",
        shortName: "Al-Falaq",
        lang: "en-US",
        text: `Say: I seek refuge in the Lord of the Daybreak
From the evil of that which He created;
From the evil of the darkness when it is intense,
And from the evil of malignant witchcraft,
And from the evil of the envier when he envieth.`,
      },
      {
        id: "an-nas",
        name: "Surah An-Nas",
        shortName: "An-Nas",
        lang: "en-US",
        text: `Say: I seek refuge in the Lord of mankind,
The King of mankind,
The God of mankind,
From the evil of the sneaking whisperer,
Who whispereth in the hearts of mankind,
Of the jinn and of mankind.`,
      },
    ],
  },
  {
    id: "buddhist",
    label: "Buddhist",
    prayers: [
      {
        id: "triple-refuge",
        name: "Triple Refuge",
        shortName: "Triple Refuge",
        lang: "en-US",
        text: `I go for refuge to the Buddha.
I go for refuge to the Dharma.
I go for refuge to the Sangha.
A second time I go for refuge to the Buddha.
A second time I go for refuge to the Dharma.
A second time I go for refuge to the Sangha.
A third time I go for refuge to the Buddha.
A third time I go for refuge to the Dharma.
A third time I go for refuge to the Sangha.`,
      },
      {
        id: "metta",
        name: "Metta (Loving-Kindness)",
        shortName: "Metta",
        lang: "en-US",
        text: `May all beings be happy.
May all beings be safe.
May all beings be free from suffering.
May all beings live in peace.`,
      },
    ],
  },
  {
    id: "hindu",
    label: "Hindu",
    prayers: [
      {
        id: "gayatri",
        name: "Gayatri Mantra",
        shortName: "Gayatri",
        lang: "en-US",
        text: `Om bhur bhuvah svah.
Tat savitur varenyam.
Bhargo devasya dhimahi.
Dhiyo yo nah prachodayat.`,
      },
    ],
  },
];

export function traditionById(id: TraditionId): Tradition | undefined {
  return TRADITIONS.find((t) => t.id === id);
}

export function prayerByIds(traditionId: TraditionId, prayerId: string): Prayer | undefined {
  return traditionById(traditionId)?.prayers.find((p) => p.id === prayerId);
}
