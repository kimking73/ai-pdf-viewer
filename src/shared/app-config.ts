import appConfig from '../../app.config.json';

// 앱 이름과 번들 ID의 원본은 저장소 루트의 app.config.json 하나다.
// 패키징 설정(electron-builder.config.mjs)도 같은 파일을 읽는다.
export const APP_NAME: string = appConfig.productName;
