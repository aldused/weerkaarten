import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from enrich_knmi_warning_annual import extract, secure_url

class ContextTests(unittest.TestCase):
    def test_article_context_excludes_hero_photo_and_keeps_official_figures(self):
        html='''<main><img src="https://cdn.knmi.nl/photo.jpg"><div class="datacenter-detail"><div class="datacenter-detail__main"><p class="intro">Onweer met windstoten.</p><h2>Weersituatie</h2><p>Een koufront trok over Nederland.</p><h2>Impact</h2><p>Treinen reden met vertraging.</p></div><figure><a class="figure__link" href="https://cdn.knmi.nl/map.png"><img data-src="https://cdn.knmi.nl/small.png" alt="Code oranje"></a><figcaption>Waarschuwing om 18 uur</figcaption></figure><figure><a class="figure__link" href="https://example.com/foreign.jpg"><img alt="Foto elders"></a></figure></div></main>'''
        context=extract(html,'https://www.knmi.nl/terugblik')
        self.assertEqual(context['description'],'Onweer met windstoten.')
        self.assertEqual(context['detail'],'Een koufront trok over Nederland.')
        self.assertEqual(context['impact'],'Treinen reden met vertraging.')
        self.assertEqual(len(context['factsheet_images']),1)
        self.assertEqual(context['factsheet_images'][0]['url'],'https://cdn.knmi.nl/map.png')

    def test_news_and_relative_links_are_supported_without_inventing_a_source(self):
        context=extract('<main><div><p class="intro">Een zware storm.</p><p>Harde wind ontregelde het verkeer.</p></div></main>','https://www.knmi.nl/nieuws/storm')
        self.assertEqual(context['description'],'Een zware storm.')
        self.assertEqual(context['detail'],'Harde wind ontregelde het verkeer.')
        self.assertEqual(secure_url('/kennis/storm','https://www.knmi.nl/jaar','www.knmi.nl'),'https://www.knmi.nl/kennis/storm')
        self.assertEqual(secure_url('http://www.knmi.nl/storm','https://www.knmi.nl/jaar','www.knmi.nl'),'https://www.knmi.nl/storm')
        self.assertIsNone(secure_url('https://elsewhere.nl/storm','https://www.knmi.nl/jaar','www.knmi.nl'))
        with self.assertRaises(ValueError):extract('<main><h1>Niet gevonden</h1></main>','https://www.knmi.nl/missing')

if __name__=='__main__':unittest.main()
