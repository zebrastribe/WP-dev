<?php
declare(strict_types=1);

final class Database
{
    private PDO $pdo;

    public function __construct(string $dbPath, string $schemaFile)
    {
        $dir = dirname($dbPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        $this->pdo = new PDO('sqlite:' . $dbPath, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);

        if (is_readable($schemaFile)) {
            $this->pdo->exec((string) file_get_contents($schemaFile));
        }
    }

    public function pdo(): PDO
    {
        return $this->pdo;
    }
}
