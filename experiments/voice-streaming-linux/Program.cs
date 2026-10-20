// No server startup or private configuration access in this experiment.
if (args.Length == 1 && args[0] == "--socket-api") return StreamingSocketInspection.Run();
if (args.Length == 1) return StreamingLoopbackProbe.Run(args[0]);
Console.Error.WriteLine("Use --socket-api or an absolute path to the test clock library.");
return 1;
