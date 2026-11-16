<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
function respond(array $data,int $status=200): never {
    http_response_code($status);
    echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);exit;
}
$requestPath=parse_url($_SERVER['REQUEST_URI']??'',PHP_URL_PATH)??'';
// Apache/LiteSpeed retains the script's installation directory after rewriting.
$base=rtrim(str_replace('\\','/',dirname($_SERVER['SCRIPT_NAME']??'/api.php')),'/');
if($base==='.') $base='';
$path=str_starts_with($requestPath,$base.'/')?substr($requestPath,strlen($base)):'';
$method=$_SERVER['REQUEST_METHOD']??'GET';
if(!in_array($path,['/api/state','/api/action'],true)) respond(['error'=>'Страница не найдена.'],404);
if(($path==='/api/state'&&$method!=='GET')||($path==='/api/action'&&$method!=='POST')) respond(['error'=>'Метод не поддерживается.'],405);
$secure=(!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off')||($_SERVER['SERVER_PORT']??'')==='443';
$payload=null;
if($method==='POST') {
    $origin=$_SERVER['HTTP_ORIGIN']??'';
    $expected=($secure?'https://':'http://').($_SERVER['HTTP_HOST']??'');
    if($origin!==''&&!hash_equals($expected,$origin)) respond(['error'=>'Запрос с другого сайта отклонён.'],403);
    if(($_SERVER['HTTP_SEC_FETCH_SITE']??'')==='cross-site') respond(['error'=>'Запрос с другого сайта отклонён.'],403);
    if(!str_starts_with(strtolower($_SERVER['CONTENT_TYPE']??''),'application/json')) respond(['error'=>'Нужен JSON-запрос.'],415);
    if((int)($_SERVER['CONTENT_LENGTH']??0)>16384) respond(['error'=>'Слишком большой запрос.'],413);
    $body=file_get_contents('php://input',false,null,0,16385);
    if($body===false||strlen($body)>16384) respond(['error'=>'Слишком большой запрос.'],413);
    try {$payload=json_decode($body,true,32,JSON_THROW_ON_ERROR);} catch(Throwable $e) {respond(['error'=>'Некорректный запрос.'],400);}
    if(!is_array($payload)||array_is_list($payload)) respond(['error'=>'Некорректный запрос.'],400);
}
$db=null;$transaction=false;
try {
    require_once __DIR__.'/private/Game.php';
    if(!extension_loaded('pdo_sqlite')||!extension_loaded('mbstring')) throw new RuntimeException('Enable pdo_sqlite and mbstring in PHP configuration.');
    $data=json_decode(file_get_contents(__DIR__.'/private/story.json'),true,512,JSON_THROW_ON_ERROR);
    $dir=__DIR__.'/private/data';
    if(!is_dir($dir)&&!mkdir($dir,0700,true)&&!is_dir($dir)) throw new RuntimeException('Cannot create private/data.');
    $db=new PDO('sqlite:'.$dir.'/game.sqlite',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA busy_timeout=5000');
    $db->exec('PRAGMA foreign_keys=ON');
    $db->exec('CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,token TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS saves(player TEXT NOT NULL,slot TEXT NOT NULL,state TEXT NOT NULL,saved_at TEXT NOT NULL,PRIMARY KEY(player,slot),FOREIGN KEY(player) REFERENCES players(id) ON DELETE CASCADE)');
    // The transaction also serializes simultaneous actions from two tabs/workers.
    $db->exec('BEGIN IMMEDIATE');$transaction=true;
    $cookie=$_COOKIE['between_worlds_player']??'';
    $id=is_string($cookie)&&preg_match('/^[a-f0-9]{64}$/D',$cookie)?hash('sha256',$cookie):'';
    $q=$db->prepare('SELECT * FROM players WHERE id=?');$q->execute([$id]);$row=$q->fetch();$q->closeCursor();
    if(!$row) {
        if($method==='POST') {$db->exec('ROLLBACK');$transaction=false;respond(['error'=>'Открой игру заново, чтобы восстановить соединение.'],403);}
        $cookie=bin2hex(random_bytes(32));$id=hash('sha256',$cookie);
        $row=['state'=>json_encode($data['fresh'],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),'revision'=>0,'token'=>bin2hex(random_bytes(32))];
        $q=$db->prepare('INSERT INTO players(id,token,state,revision,updated_at) VALUES(?,?,?,?,?)');$q->execute([$id,$row['token'],$row['state'],0,time()]);
    }
    $game=new Game($db,$id,$data,$row);
    if($method==='POST') {
        if(!hash_equals($row['token'],$_SERVER['HTTP_X_GAME_TOKEN']??'')) {$db->exec('ROLLBACK');$transaction=false;respond(['error'=>'Обнови страницу и повтори действие.'],403);}
        $result=['state'=>$game->act($payload)];
    } else $result=['state'=>$game->view(),'token'=>$row['token']];
    $db->exec('COMMIT');$transaction=false;
    setcookie('between_worlds_player',$cookie,['expires'=>time()+31536000,'path'=>$base.'/','secure'=>$secure,'httponly'=>true,'samesite'=>'Lax']);
    respond($result);
} catch(GameError $e) {
    if($transaction) $db->exec('ROLLBACK');
    respond(['error'=>$e->getMessage()],409);
} catch(Throwable $e) {
    if($transaction) $db->exec('ROLLBACK');
    error_log('Between worlds: '.$e->getMessage());
    respond(['error'=>'Сохранения временно недоступны. Попробуй позже. Владелец сайта может проверить журнал ошибок PHP.'],503);
}
