import { faker } from '@faker-js/faker/locale/zh_TW';

export function randomChineseName() {
  return faker.person.fullName();
}
