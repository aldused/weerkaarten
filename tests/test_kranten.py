import copy
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('kranten', ROOT / 'scripts/kranten_update.py')
k = importlib.util.module_from_spec(spec)
spec.loader.exec_module(k)


def source_html(day='12 september 2026', start='Morgen'):
    return f'''<p>Geplaats op zaterdag {day} om 05:45 door Ed Aldus</p>
    <div id="readarea"><h1>Een nieuwe verwachting</h1><p>Vandaag 99 graden.</p>
    <p><strong>{start}</strong> is het 20 graden.</p><p>De dagen daarna 23 graden.</p>
    <div class="weather-reporter-card"><p>Auteursbiografie mag niet mee.</p></div></div>'''


class KrantenTest(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 12, 7, tzinfo=k.TZ)
        self.source = k.parse_source(source_html(), self.now)
        articles = {}
        for key, (unit, low, _high) in k.LENGTH_RULES.items():
            if unit == 'characters':
                prefix = 'Vandaag morgen '
                body = prefix + ('a' * (low - len(prefix) - 1)) + '.'
            else:
                body = 'Vandaag morgen ' + 'weer ' * (low - 3 if low > 3 else 1) + 'zon.'
            articles[key] = {'title': '' if key == 'vk_lang' else 'Regen en zon', 'body': body}
        self.candidate = {
            'sourceId': self.source['id'], 'sourceDate':'2026-09-12', 'publicationDate':'2026-09-13',
            'demoOnly':True, 'author':'Ed Aldus', 'usedParagraphs':[1,2],
            'articles': articles
        }

    def test_extracts_real_article_and_boundary(self):
        self.assertEqual(self.source['eligibleParagraphs'], [1,2])
        self.assertEqual(len(self.source['paragraphs']),3)
        self.assertNotIn('biografie', json.dumps(self.source))

    def test_valid_candidate(self):
        self.assertEqual(k.validate(self.candidate,self.source,self.now),[])

    def test_outdated_source_rejected(self):
        with self.assertRaises(ValueError): k.parse_source(source_html('11 september 2026'),self.now)

    def test_no_morgen_boundary_rejected(self):
        with self.assertRaises(ValueError): k.parse_source(source_html(start='Later'),self.now)

    def test_day_rollover_including_dst(self):
        for date,expected in [('31 december 2026','2027-01-01'),('28 maart 2026','2026-03-29'),('24 oktober 2026','2026-10-25')]:
            y=int(date.split()[2]);m=k.MONTHS.index(date.split()[1])+1;d=int(date.split()[0])
            source=k.parse_source(source_html(date),datetime(y,m,d,7,tzinfo=k.TZ))
            self.assertEqual(source['publicationDate'],expected)

    def test_today_cannot_be_used(self):
        self.candidate['usedParagraphs']=[0,1]
        self.assertTrue(k.validate(self.candidate,self.source,self.now))

    def test_sunday_must_be_demo(self):
        self.candidate['demoOnly']=False
        self.assertTrue(k.validate(self.candidate,self.source,self.now))

    def test_source_revision_must_match(self):
        self.candidate['sourceId']='old'
        self.assertTrue(k.validate(self.candidate,self.source,self.now))

    def test_length_title_author_and_punctuation(self):
        for field,value in [('title','Een veel te lange titel vandaag'),('body','Vandaag morgen '+ 'regen '*30+'.'),('body','Vandaag morgen regen , zon.')]:
            with self.subTest(field=field,value=value):
                candidate=copy.deepcopy(self.candidate);candidate['articles']['vk_kort'][field]=value
                self.assertTrue(k.validate(candidate,self.source,self.now))
        self.candidate['author']=''
        self.assertTrue(k.validate(self.candidate,self.source,self.now))

    def test_trouw_counts_characters_including_spaces(self):
        candidate=copy.deepcopy(self.candidate)
        candidate['articles']['trouw']['body']='Vandaag ' + 'a' * 890 + '.'
        errors=k.validate(candidate,self.source,self.now)
        self.assertTrue(any('karakters inclusief spaties' in error for error in errors))

    def test_title_rules_follow_newspaper_table(self):
        self.candidate['articles']['ad']['title']='Veel zon maar soms buien'
        self.assertEqual(k.validate(self.candidate,self.source,self.now),[])
        self.candidate['articles']['vk_lang']['title']='Geen titel toegestaan'
        self.assertTrue(k.validate(self.candidate,self.source,self.now))

    def test_wrong_publication_date_rejected(self):
        self.candidate['publicationDate']='2026-09-14'
        self.assertTrue(k.validate(self.candidate,self.source,self.now))


if __name__=='__main__': unittest.main()
