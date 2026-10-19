FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY Bridge.csproj ./
RUN dotnet restore
COPY Program.cs VoiceInputPolicy.cs ./
RUN dotnet publish --no-restore -c Release -o /out && dotnet /out/Bridge.dll --input-self-test
FROM mcr.microsoft.com/dotnet/runtime:8.0
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out ./
USER 1000:1000
ENTRYPOINT ["dotnet","/app/Bridge.dll"]
