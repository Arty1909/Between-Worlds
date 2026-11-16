<?php
declare(strict_types=1);

/** Hosting edition of engine.py. Story data is exported by build_hostinger.py. */
final class GameError extends RuntimeException {}
final class Game {
    public array $state;
    public int $revision;
    public function __construct(private PDO $db, private string $player, private array $data, array $row) {
        $this->state = json_decode($row['state'], true, 512, JSON_THROW_ON_ERROR);
        $this->revision = (int)$row['revision'];
    }
    private function checkSlot(string $slot): void {
        if (!in_array($slot, ['auto','1','2','3'], true)) throw new GameError('Неизвестная ячейка сохранения.');
    }
    private function writeSlot(string $slot): void {
        $this->checkSlot($slot);
        $q = $this->db->prepare('INSERT INTO saves(player,slot,state,saved_at) VALUES(?,?,?,?) ON CONFLICT(player,slot) DO UPDATE SET state=excluded.state,saved_at=excluded.saved_at');
        $q->execute([$this->player,$slot,json_encode($this->state,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),gmdate('c')]);
    }
    private function readSlot(string $slot): array {
        $this->checkSlot($slot);
        $q=$this->db->prepare('SELECT state FROM saves WHERE player=? AND slot=?');$q->execute([$this->player,$slot]);
        $raw=$q->fetchColumn();
        if ($raw===false) throw new GameError('В этой ячейке ещё нет сохранения.');
        return json_decode($raw,true,512,JSON_THROW_ON_ERROR);
    }
    private function chapter(array $s): int {return $this->data['nodes'][$s['node']]['chapter'] ?? 5;}
    private function location(array $s): string {return $this->data['nodes'][$s['node']]['location'] ?? $this->data['endings'][$s['node']]['title'];}
    private function slots(): array {
        $q=$this->db->prepare('SELECT slot,state,saved_at FROM saves WHERE player=?');$q->execute([$this->player]);$rows=[];
        foreach($q as $r) $rows[$r['slot']]=$r;
        $result=[];
        foreach(['auto','1','2','3'] as $slot) {
            $entry=['slot'=>$slot,'exists'=>isset($rows[$slot])];
            if($entry['exists']) {
                $s=json_decode($rows[$slot]['state'],true,512,JSON_THROW_ON_ERROR);
                $entry+=['name'=>$s['name'],'chapter'=>$this->chapter($s),'location'=>$this->location($s),'saved_at'=>$rows[$slot]['saved_at']];
            }
            $result[]=$entry;
        }
        return $result;
    }
    private function logLine(array $line): void {
        $text=$line['text'];
        if(!empty($line['when'])&&!in_array($line['when'],$this->state['flags'],true)) $text=$line['alternate'];
        $this->state['history'][]=['speaker'=>$line['speaker'],'text'=>str_replace('{name}',$this->state['name'],$text)];
        $this->state['history']=array_slice($this->state['history'],-400);
    }
    private function enter(string $id): void {
        $this->state['node']=$id;$this->state['beat']=0;$this->state['feedback']=null;
        if(isset($this->data['nodes'][$id])) {
            $node=$this->data['nodes'][$id];
            if(!empty($node['clue'])&&!in_array($node['clue'],$this->state['clues'],true)) $this->state['clues'][]=$node['clue'];
            if(!empty($node['character'])&&!in_array($node['character'],$this->state['met'],true)) $this->state['met'][]=$node['character'];
            $this->logLine($node['lines'][0]);
        }
    }
    private function available(array $choice): bool {
        foreach($choice['requires']??[] as $k=>$v) if(($this->state[$k]??$this->state['stats'][$k]??0)<$v) return false;
        return true;
    }
    public function view(): array {
        $s=$this->state;$d=$this->data;
        $r=['revision'=>$this->revision,'edition'=>3,'name'=>$s['name'],'started'=>$s['started'],
            'hero'=>array_merge($d['hero'],$d['looks'][$s['look']],['name'=>$s['name']]),'emotions'=>$d['emotions'],
            'look'=>$s['look'],'looks'=>[],'stats'=>$s['stats'],'chapter'=>$this->chapter($s),'chapters'=>$d['chapters'],
            'location'=>$this->location($s),'node'=>$s['node'],'warning'=>'','clues'=>[],'characters'=>[],
            'history'=>$s['history'],'slots'=>$this->slots(),'feedback'=>$s['feedback'],'puzzle_solved'=>$s['puzzle_solved']];
        foreach($d['looks'] as $k=>$v) $r['looks'][]=['id'=>$k]+$v;
        foreach($s['clues'] as $k) $r['clues'][]=['id'=>$k]+$d['clues'][$k];
        foreach($d['characters'] as $k=>$v) $r['characters'][]=['id'=>$k]+$v+['met'=>in_array($k,$s['met'],true),'bond'=>$s['bonds'][$k]];
        if(isset($d['endings'][$s['node']])) {
            $ending=$d['endings'][$s['node']];$who='loony';
            foreach(['merry','moony'] as $k) if($s['bonds'][$k]>$s['bonds'][$who]) $who=$k;
            foreach(['stay_forest'=>'loony','stay_garden'=>'merry','stay_beacon'=>'moony'] as $flag=>$k) if(in_array($flag,$s['flags'],true)) $who=$k;
            $ending['text']=str_replace('{companion}',$d['characters'][$who]['name'],$ending['text']);
            if($s['node']==='ending_stay') [$ending['bg'],$ending['text']]=$d['stay_lives'][$who];
            $ending['afterword']=in_array('echo_released',$s['flags'],true)?($ending['after_echo']??''):(in_array('echo_remembered',$s['flags'],true)?'В дневнике остался голос Элиан. Её история ещё не закончена, но теперь она больше не забыта.':'');
            $r+=['kind'=>'ending','ending'=>$ending,'bg'=>$ending['bg'],'character'=>$s['node']==='ending_stay'?['id'=>$who]+$d['characters'][$who]:null];
        } else {
            $node=$d['nodes'][$s['node']];$who=$node['character']??null;$line=$node['lines'][$s['beat']];
            if(!empty($line['when'])&&!in_array($line['when'],$s['flags'],true)) $line['text']=$line['alternate'];
            $line['text']=str_replace('{name}',$s['name'],$line['text']);
            $emotion=$line['emotion']??'neutral';$heroEmotion=$line['hero_emotion']??'neutral';
            if($s['feedback']) {
                $effects=implode('\n',$s['feedback']['effects']);
                if(str_contains($effects,'доверие')) $emotion=$heroEmotion='warm';
                elseif(($node['kind']??'')==='quiz') $emotion=$heroEmotion=str_contains($effects,'Верных ответов')?'warm':'worried';
                else $heroEmotion='resolve';
            }
            $last=$s['beat']===count($node['lines'])-1;$choices=[];
            if($last&&!$s['feedback']) foreach($node['choices'] as $i=>$c) $choices[]=['id'=>$i,'text'=>$c['text'],'label'=>$c['label'],'available'=>$this->available($c)];
            $r+=['kind'=>$node['kind']??'story','bg'=>$node['bg'],'line'=>$line,'framing'=>$node['framing']??'medium',
                'beat'=>$s['beat'],'beats'=>count($node['lines']),'choices'=>$choices,
                'character'=>$who?array_merge(['id'=>$who],$d['characters'][$who],['emotion'=>$emotion]):null,
                'hero_emotion'=>$heroEmotion,'can_advance'=>(bool)$s['feedback']||!$last];
            if(($node['kind']??'')==='puzzle') $r+=['symbols'=>$d['puzzle_symbols'],'puzzle_attempts'=>$s['puzzle_attempts']];
        }
        $bg=$r['bg'];$r['media']=['poster'=>"assets/backgrounds/$bg.jpg",'video'=>ctype_digit($bg)?"materials/$bg.mp4":null];
        if($bg==='room-v2') $r['media']['poster']='assets/backgrounds/room-v2.png';
        if(in_array($bg,['10','11'],true)) $r['media']['video']='assets/video/'.($bg==='10'?'moon-clean.mp4':'door-once.mp4');
        return $r;
    }
    public function act(array $p): array {
        if(($p['revision']??null)!==$this->revision) throw new GameError('Прогресс изменился в другом окне. Обновляем экран — повтори действие.');
        $action=$p['action']??null;$d=$this->data;
        if($action==='new') {
            $name=$p['name']??'Арти';
            if(!is_string($name)) throw new GameError('Введи имя героини.');
            $name=trim(preg_replace('/\s+/u',' ',$name)??'');
            if(mb_strlen($name)<1||mb_strlen($name)>24||preg_match('/[\x00-\x1f]/u',$name)) throw new GameError('Имя должно содержать от 1 до 24 символов.');
            $look=$this->state['look'];$this->state=$d['fresh'];$this->state['name']=$name;$this->state['look']=$look;$this->state['started']=true;$this->enter('ordinary_evening');
        } elseif($action==='dress') {
            $look=$p['look']??null;
            if(!is_string($look)||!isset($d['looks'][$look])) throw new GameError('Выбери один из образов гардероба.');
            $this->state['look']=$look;
        } elseif($action==='load'||$action==='save') {
            $slot=$p['slot']??'';
            if(!is_string($slot)&&!is_int($slot)) throw new GameError('Неизвестная ячейка сохранения.');
            $slot=(string)$slot;
            if($action==='load') $this->state=$this->readSlot($slot);
            else {
                if(!$this->state['started']) throw new GameError('Сначала начни историю.');
                if(!in_array($slot,['1','2','3'],true)) throw new GameError('Выбери одну из трёх ручных ячеек.');
                $this->writeSlot($slot);
            }
        } elseif(isset($d['endings'][$this->state['node']])||!$this->state['started']) throw new GameError('Начни новую историю или загрузи сохранение.');
        elseif($action==='advance') {
            if($this->state['feedback']) $this->enter($this->state['feedback']['next']);
            else {
                $node=$d['nodes'][$this->state['node']];
                if($this->state['beat']>=count($node['lines'])-1) throw new GameError('Сначала сделай выбор.');
                $this->state['beat']++;$this->logLine($node['lines'][$this->state['beat']]);
            }
        } elseif($action==='choose') {
            $node=$d['nodes'][$this->state['node']];$i=$p['choice']??null;
            if($this->state['feedback']||$this->state['beat']!==count($node['lines'])-1) throw new GameError('Сначала дочитай реплику.');
            if(!is_int($i)||$i<0||$i>=count($node['choices'])) throw new GameError('Такого выбора нет.');
            $c=$node['choices'][$i];
            if(!$this->available($c)) throw new GameError('Этот путь пока недоступен.');
            $effects=[];
            foreach($c['effects'] as $key=>$amount) {
                if(str_starts_with($key,'bond_')) {$who=substr($key,5);$this->state['bonds'][$who]+=$amount;$effects[]=$d['characters'][$who]['name'].": доверие +$amount";}
                else {$this->state['stats'][$key]+=$amount;$effects[]=$d['stat_names'][$key]." +$amount";}
            }
            if($c['clue']&&!in_array($c['clue'],$this->state['clues'],true)) $this->state['clues'][]=$c['clue'];
            foreach($c['set_flags']??[] as $flag) if(!in_array($flag,$this->state['flags'],true)) $this->state['flags'][]=$flag;
            $this->logLine(['speaker'=>'hero','text'=>$c['text']]);$this->logLine(['speaker'=>'narrator','text'=>$c['reply']]);
            $this->state['feedback']=['text'=>$c['reply'],'next'=>$c['next'],'effects'=>$effects];
        } elseif($action==='puzzle'||$action==='skip_puzzle') {
            if($this->state['node']!=='mechanism'||$this->state['feedback']) throw new GameError('Механизм сейчас недоступен.');
            if($action==='skip_puzzle') $feedback=['text'=>'Саэль поворачивает кольца за тебя. «Помощь — тоже часть пути». Дверь открыта, но тайну соединения миров ещё предстоит понять.','next'=>'last_reflection','effects'=>['Саэль помогла открыть дверь']];
            else {
                $symbols=$p['symbols']??null;$valid=array_column($d['puzzle_symbols'],'id');
                if(!is_array($symbols)||!array_is_list($symbols)||count($symbols)!==3) throw new GameError('Выбери три разных символа.');
                foreach($symbols as $symbol) if(!is_string($symbol)||!in_array($symbol,$valid,true)) throw new GameError('Выбери три разных символа.');
                if(count(array_unique($symbols))!==3) throw new GameError('Выбери три разных символа.');
                $this->state['puzzle_attempts']=min($this->state['puzzle_attempts']+1,9999);
                if($symbols!==$d['puzzle_answer']) $feedback=['text'=>'Механизм тихо щёлкает и замирает. Начни с живого, затем вспомни тепло и отражённый свет. Подсказки сохранены в дневнике.','next'=>'mechanism','effects'=>['Можно попробовать снова']];
                else {$this->state['puzzle_solved']=true;$feedback=['text'=>'Лист. Пламя. Луна. Три кольца совпадают, и свет пробегает по ключу. Дверь между мирами открыта.','next'=>'last_reflection','effects'=>['Лунный механизм разгадан']];}
            }
            $this->state['feedback']=$feedback;$this->logLine(['speaker'=>'narrator','text'=>$feedback['text']]);
        } else throw new GameError('Неизвестное действие.');
        $this->writeSlot('auto');$this->revision++;
        $q=$this->db->prepare('UPDATE players SET state=?,revision=?,updated_at=? WHERE id=?');
        $q->execute([json_encode($this->state,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),$this->revision,time(),$this->player]);
        return $this->view();
    }
}
