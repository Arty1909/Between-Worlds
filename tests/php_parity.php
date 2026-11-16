<?php
require dirname(__DIR__).'/hosting/private/Game.php';
$input=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);
$db=new PDO('sqlite::memory:');$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
$db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE,PDO::FETCH_ASSOC);
$db->exec('CREATE TABLE players(id TEXT PRIMARY KEY,state TEXT,revision INTEGER,updated_at INTEGER)');
$db->exec('CREATE TABLE saves(player TEXT,slot TEXT,state TEXT,saved_at TEXT,PRIMARY KEY(player,slot))');
foreach($input['runs'] as $index=>$run) {
    $id=(string)$index;$row=['state'=>json_encode($input['data']['fresh']),'revision'=>0];
    $db->prepare('INSERT INTO players VALUES(?,?,0,0)')->execute([$id,$row['state']]);
    $game=new Game($db,$id,$input['data'],$row);
    echo json_encode(['run'=>$index,'step'=>-1,'view'=>$game->view()],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n";
    foreach($run as $step=>$payload) {
        $db->beginTransaction();
        try {$view=$game->act($payload);$db->commit();$out=['view'=>$view];}
        catch(GameError $e) {$db->rollBack();$out=['error'=>$e->getMessage()];}
        // Every request reconstructs the engine, as in a shared PHP host.
        $q=$db->prepare('SELECT state,revision FROM players WHERE id=?');$q->execute([$id]);
        $game=new Game($db,$id,$input['data'],$q->fetch());
        echo json_encode(['run'=>$index,'step'=>$step]+$out,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n";
    }
}
