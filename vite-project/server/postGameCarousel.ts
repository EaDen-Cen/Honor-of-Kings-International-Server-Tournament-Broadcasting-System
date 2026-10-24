import {
  carouselPages,
  carouselReady,
  defaultCarouselConfig,
  type CarouselConfig,
  type CarouselPage,
  type CarouselSnapshot,
} from '../src/shared/postGameCarousel.js';
import type { MatchState } from '../src/shared/types.js';
import type { SecureSettings } from './secureSettings.js';
export class PostGameCarousel {
  private config: CarouselConfig;
  private page: CarouselPage | null = null;
  private status: CarouselSnapshot['status'] = 'stopped';
  private deadline: number | null = null;
  private remaining = 0;
  private reportId: string | null = null;
  private error = '';
  private busy = false;
  private generation = 0;
  constructor(
    private storage: SecureSettings,
    private state: () => MatchState,
    private switchScene: (scene: string, isCurrent?: () => boolean) => Promise<unknown>,
    private now = Date.now,
  ) {
    this.config = { ...defaultCarouselConfig(), ...storage.get<CarouselConfig>('carousel') };
  }
  snapshot(): CarouselSnapshot {
    return {
      config: this.config,
      page: this.page,
      status: this.status,
      deadline: this.deadline,
      reportId: this.reportId,
      error: this.error,
      missing: carouselPages.filter((p) => !carouselReady(this.state(), p)),
    };
  }
  configure(input: CarouselConfig) {
    if (
      !Array.isArray(input.order) ||
      input.order.length !== 6 ||
      new Set(input.order).size !== 6 ||
      input.order.some((p) => !carouselPages.includes(p)) ||
      carouselPages.some(
        (p) =>
          !Number.isFinite(input.seconds?.[p]) || input.seconds[p] < 2 || input.seconds[p] > 120,
      ) ||
      typeof input.skipMissing !== 'boolean' ||
      typeof input.endScene !== 'string' ||
      input.endScene.length > 128 ||
      !input.scenes ||
      Object.entries(input.scenes).some(
        ([p, s]) =>
          !carouselPages.includes(p as CarouselPage) || typeof s !== 'string' || s.length > 128,
      )
    )
      throw Error('Invalid carousel configuration');
    this.storage.set('carousel', input);
    this.config = structuredClone(input);
    return this.snapshot();
  }
  pause() {
    this.generation++;
    if (this.status === 'running') {
      this.remaining = Math.max(0, (this.deadline ?? this.now()) - this.now());
      this.status = 'paused';
      this.deadline = null;
    }
  }
  private async show(page: CarouselPage) {
    const generation = this.generation;
    if (!carouselReady(this.state(), page)) throw Error('所选对位数据或经济曲线尚未核验完整');
    const scene = this.config.scenes[page];
    if (scene) await this.switchScene(scene, () => generation === this.generation);
    if (generation !== this.generation) return false;
    this.page = page;
    this.remaining = this.config.seconds[page] * 1000;
    this.deadline = this.now() + this.remaining;
    this.error = '';
    return true;
  }
  async command(action: string, page?: CarouselPage) {
    if (action === 'pause' || action === 'stop') {
      this.pause();
      if (action === 'stop') this.status = 'stopped';
      return this.snapshot();
    }
    if (this.busy) throw Error('轮播切换处理中');
    const generation = this.generation;
    this.busy = true;
    try {
      if (action === 'resume') {
        if (
          this.reportId !== this.state().activePostGameReportId ||
          !this.page ||
          !carouselReady(this.state(), this.page)
        )
          throw Error('报告已变化或数据不完整，请重新开始');
        this.status = 'running';
        this.deadline = this.now() + (this.remaining || this.config.seconds[this.page] * 1000);
        return this.snapshot();
      }
      let target = page;
      if (action === 'start') {
        this.reportId = this.state().activePostGameReportId;
        target = this.config.order.find(
          (p) => !this.config.skipMissing || carouselReady(this.state(), p),
        );
      } else if (action === 'next' || action === 'previous') {
        const offset = action === 'next' ? 1 : -1;
        let index = this.config.order.indexOf(this.page!) + offset;
        while (
          index >= 0 &&
          index < 6 &&
          this.config.skipMissing &&
          !carouselReady(this.state(), this.config.order[index])
        )
          index += offset;
        target = this.config.order[index];
      } else if (action !== 'show') throw Error('Invalid carousel command');
      if (!target) {
        this.status = 'stopped';
        this.deadline = null;
        if (action === 'start') throw Error('没有可展示的已核验数据');
        if (this.config.endScene && action === 'next')
          await this.switchScene(this.config.endScene, () => generation === this.generation);
        return this.snapshot();
      }
      if (!carouselPages.includes(target)) throw Error('Invalid page');
      if (!(await this.show(target))) return this.snapshot();
      this.reportId = this.state().activePostGameReportId;
      this.status = action === 'show' ? 'paused' : 'running';
      if (this.status === 'paused') this.deadline = null;
      return this.snapshot();
    } catch (error) {
      if (generation !== this.generation) return this.snapshot();
      this.error = error instanceof Error ? error.message : '轮播失败';
      this.pause();
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async tick() {
    if (this.status !== 'running' || this.busy) return;
    if (
      this.reportId !== this.state().activePostGameReportId ||
      (this.page && !carouselReady(this.state(), this.page))
    ) {
      this.pause();
      this.error = '报告或数据状态变化，轮播已暂停';
      return;
    }
    if (this.now() >= (this.deadline ?? Infinity))
      try {
        await this.command('next');
      } catch {
        /* Keep the error visible and paused. */
      }
  }
}
