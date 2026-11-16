"""Run against the isolated Apache staging site, never the author's live game."""
import concurrent.futures
import http.cookiejar
import json
import os
from pathlib import Path
import unittest
from urllib.request import Request,build_opener,HTTPCookieProcessor
from urllib.error import HTTPError
from urllib.parse import urlsplit, urljoin
from html.parser import HTMLParser

BASE=os.environ.get('HOSTING_TEST_URL','http://127.0.0.1:8770')
ORIGIN=f'{urlsplit(BASE).scheme}://{urlsplit(BASE).netloc}'
assert BASE.startswith('http://127.0.0.1:'), 'Use an isolated local staging server.'

class Client:
    def __init__(self):
        self.jar=http.cookiejar.CookieJar();self.opener=build_opener(HTTPCookieProcessor(self.jar))
    def request(self,path,body=None,headers=None):
        headers=headers or {}
        if body is not None: headers={'Content-Type':'application/json',**headers};body=json.dumps(body).encode()
        try: response=self.opener.open(Request(BASE+path,data=body,headers=headers),timeout=15)
        except HTTPError as e: response=e
        with response: return response.status,response.headers,response.read()
    def state(self):
        code,_,body=self.request('/api/state');assert code==200,(code,body)
        return json.loads(body)
    def act(self,s,action,**extra):
        code,_,body=self.request('/api/action',{'action':action,'revision':s['state']['revision'],**extra},{'X-Game-Token':s['token'],'Origin':ORIGIN})
        return code,json.loads(body)

@unittest.skipUnless(os.environ.get('HOSTING_TEST_URL'), 'Set HOSTING_TEST_URL to an isolated Apache staging site.')
class HostingTests(unittest.TestCase):
    def test_independent_players_persistence_and_saved_slots(self):
        a,b=Client(),Client();sa,sb=a.state(),b.state()
        self.assertNotEqual(sa['token'],sb['token'])
        status,result=a.act(sa,'new',name='Тест Арти');self.assertEqual(status,200)
        sa=a.state();self.assertEqual(sa['state']['name'],'Тест Арти')
        self.assertFalse(b.state()['state']['started'])
        self.assertEqual(a.act(sa,'save',slot='1')[0],200)
        sa=a.state();self.assertTrue(sa['state']['slots'][1]['exists'])
        self.assertFalse(b.state()['state']['slots'][1]['exists'])
        # A new HTTP client carrying the same cookie recovers the saved progress.
        c=Client()
        for cookie in a.jar: c.jar.set_cookie(cookie)
        self.assertEqual(c.state()['state'],sa['state'])
        self.assertEqual(a.act(sa,'dress',look='moon')[0],200)
        self.assertEqual(a.act(a.state(),'load',slot='1')[0],200)
        self.assertEqual(a.state()['state']['look'],'voyage')

    def test_rejected_requests_do_not_change_progress(self):
        c=Client();s=c.state();self.assertEqual(c.act(s,'new')[0],200);s=c.state()
        for headers,expected in [({'X-Game-Token':'wrong'},403),({'X-Game-Token':s['token'],'Origin':'https://unrelated.example'},403)]:
            status,_,_=c.request('/api/action',{'action':'advance','revision':s['state']['revision']},headers);self.assertEqual(status,expected)
        self.assertEqual(c.act(s,'advance',revision=-1)[0],409)
        self.assertEqual(c.act(s,'load',slot=['1'])[0],409)
        self.assertEqual(c.state()['state'],s['state'])
        status,_,_=c.request('/api/action',{'action':'new','name':'x'*17000},{'X-Game-Token':s['token']});self.assertEqual(status,413)
        self.assertEqual(c.state()['state'],s['state'])

    def test_parallel_tabs_only_apply_action_once(self):
        c=Client();s=c.state();c.act(s,'new');s=c.state()
        clients=[Client(),Client()]
        for other in clients:
            for cookie in c.jar: other.jar.set_cookie(cookie)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            codes=list(pool.map(lambda other:other.act(s,'advance')[0],clients))
        self.assertEqual(sorted(codes),[200,409])
        self.assertEqual(c.state()['state']['beat'],1)

    def test_apache_private_paths_headers_and_video_ranges(self):
        c=Client()
        for path in ['/private/story.json','/private/Game.php','/private/data/game.sqlite','/private/data/game.sqlite-journal','/.htaccess','/.user.ini','/assets/','/api.php']:
            code,_,_=c.request(path);self.assertIn(code,[403,404],path)
        code,h,body=c.request('/');self.assertEqual(code,200);self.assertIn(b'branding/logo.svg',body)
        self.assertEqual(h['X-Content-Type-Options'],'nosniff');self.assertIn("frame-ancestors 'none'",h['Content-Security-Policy'])
        code,h,body=c.request('/api/state');self.assertEqual(code,200);self.assertIn('no-store',h['Cache-Control'])
        self.assertIn('HttpOnly',h['Set-Cookie']);self.assertIn('SameSite=Lax',h['Set-Cookie'])
        self.assertIn('path='+urlsplit(BASE+'/').path,h['Set-Cookie'])
        code,h,body=c.request('/assets/video/door-once.mp4',headers={'Range':'bytes=0-1023'})
        self.assertEqual(code,206);self.assertEqual(len(body),1024);self.assertTrue(h['Content-Range'].startswith('bytes 0-1023/'))

    def test_nested_entrypoint_styles_scripts_icons_and_manifest(self):
        c=Client();code,_,html=c.request('/');self.assertEqual(code,200)
        links=[]
        class Links(HTMLParser):
            def handle_starttag(self,tag,attrs):
                if tag in ('script','link','img'):
                    attrs=dict(attrs)
                    if attrs.get('src') or attrs.get('href'): links.append(attrs.get('src') or attrs['href'])
        Links().feed(html.decode())
        for link in links:
            url=urljoin(BASE+'/',link)
            self.assertTrue(url.startswith(BASE+'/'),url)
            status,_,_=c.request('/'+url[len(BASE+'/'):]);self.assertEqual(status,200,url)
        code,_,body=c.request('/web/app.webmanifest');self.assertEqual(code,200)
        manifest=json.loads(body);manifest_url=BASE+'/web/app.webmanifest'
        for key in ('id','start_url','scope'): self.assertEqual(urljoin(manifest_url,manifest[key]),BASE+'/')
        for icon in manifest['icons']:
            url=urljoin(manifest_url,icon['src']);self.assertTrue(url.startswith(BASE+'/'))
            self.assertEqual(c.request('/'+url[len(BASE+'/'):])[0],200)
        # Use the same relative media paths supplied to the browser by the actual engine.
        state=c.state();self.assertEqual(c.act(state,'new')[0],200);view=c.state()['state']
        for resource in [view['media']['poster'],view['hero']['image'],*view['hero']['emotion_images'].values(),'assets/music/room-v2.mp3','materials/0.mp4']:
            url=urljoin(BASE+'/',resource);self.assertTrue(url.startswith(BASE+'/'))
            self.assertIn(c.request('/'+resource,headers={'Range':'bytes=0-63'})[0],[200,206])

if __name__=='__main__': unittest.main(verbosity=2)
