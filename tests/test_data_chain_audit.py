import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import knmi_live_day as live
import lopend_patch
from knmi_station_ids import station_wigos

class Response:
    status_code=200
    def raise_for_status(self):pass
    def json(self):
        return {'coverages':[{'eumetnet:locationId':'x','domain':{'axes':{'t':{'values':['2026-01-01T00:10:00Z','2026-01-01T00:30:00Z']}}},'ranges':{'rg':{'values':[6,6]},'ta':{'values':[1,3]}}}]}

class ChainTests(unittest.TestCase):
    def test_partial_response_keeps_known_rows_without_double_counting(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);dest=root/'data/observations/344';dest.mkdir(parents=True)
            p=dest/'2026-01-01.json';p.write_text(json.dumps({'station':344,'date':'2026-01-01','rows':[{'time':'2026-01-01T00:20:00Z','rg':6,'ta':2}]}))
            with patch.object(live,'ROOT',root),patch.object(live,'knmi_get',return_value=Response()):
                first=live.fetch_live_day(344,date(2026,1,1),'x');second=live.fetch_live_day(344,date(2026,1,1),'x')
            self.assertEqual(first,second);self.assertEqual(first['rh'],3);self.assertEqual(first['tg'],2)
            data=json.loads(p.read_text());self.assertEqual(len(data['rows']),3);self.assertEqual(data['quality']['missing_times'],[])

    def test_publication_signature_stays_uncommitted_until_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory)/'state.json';pending=Path(directory)/'pending.json';state.write_text('{"344":"old"}')
            with patch.object(lopend_patch,'STATE_FILE',str(state)),patch.dict('os.environ',{'LOPEND_STATE_PENDING':str(pending)}):lopend_patch.save_state({'344':'new'})
            self.assertEqual(json.loads(state.read_text()),{'344':'old'});self.assertEqual(json.loads(pending.read_text()),{'344':'new'})

    def test_horst_uses_the_confirmed_knmi_identifier(self):
        self.assertEqual(station_wigos(392),'0-528-0-06392');self.assertEqual(station_wigos(344),'0-20000-0-06344')

if __name__=='__main__':unittest.main()
