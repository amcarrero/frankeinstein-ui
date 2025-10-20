import { atom, type SetStateAction } from 'jotai'

const DEFAULT_GOOGLE_MAPS_API_KEY = 'AIzaSyA2Mq9ZPEKKhF6SRhpVm9gHf7j1VFvTIrg'

export const googleMapsApiKeyAtom = atom(DEFAULT_GOOGLE_MAPS_API_KEY)

export const needsApiKeyPrimitiveAtom = atom(false)
export const needsApiKeyAtom = atom(
  get => get(needsApiKeyPrimitiveAtom) && get(googleMapsApiKeyAtom) === '',
  (_get, set, value: SetStateAction<boolean>) => {
    set(needsApiKeyPrimitiveAtom, value)
  }
)
